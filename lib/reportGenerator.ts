import { prisma } from './db'
import type { Report } from '@prisma/client'
import {
  searchProperty,
  getRentEstimate,
  getComparableSales,
  getRentComps,
  getMarketSnapshot,
  type PropertyData,
  type RentEstimate,
  type MarketSnapshot,
} from './propertyApi'
import {
  getCurrentRates,
  applyInvestorPremium,
  INVESTOR_PREMIUM,
  type Strategy,
  type CurrentRates,
} from './rates'
import {
  calculateDealMetrics,
  calculateBreakEvenPrice,
  calculateCashToClose,
  projectWealth,
  calculateHoldPeriodIRR,
  calculateFinancingAlternatives,
  calculateSensitivity,
  calculateRecommendedOffers,
  calculateSTRProjection,
  getStatePropertyTaxGrowth,
  STATE_RULES,
} from './calculations'
import { generateDealDoctor, estimateSTRRevenue, type DealDoctorOutput } from './dealDoctor'
import { getClimateAndInsurance, type ClimateAndInsurance } from './climateRisk'
import { getLocationSignals, type LocationSignals } from './locationSignals'
import { applyStudentHousingHeuristic } from './studentHousing'

/**
 * The inputs composeFullReport needs. All external-service calls happen in
 * generateFullReport; compose is a pure function of these results + the
 * Report row. `PromiseSettledResult` preserves rejection info so compose can
 * log per-endpoint failures and degrade gracefully.
 */
export interface ReportFetchResults {
  property: PropertyData
  rates: CurrentRates
  rentEstimate: PromiseSettledResult<RentEstimate | null>
  saleComps: PromiseSettledResult<any[]>
  rentComps: PromiseSettledResult<any[]>
  marketSnapshot: PromiseSettledResult<MarketSnapshot | null>
  climate: PromiseSettledResult<ClimateAndInsurance | null>
  locationSignals: PromiseSettledResult<LocationSignals | null>
}

/**
 * AI narration factory — injected into composeFullReport so tests can pass a
 * deterministic stub instead of calling Anthropic. Default wires to the real
 * Claude Haiku generator.
 */
export type AiGenerator = typeof generateDealDoctor

/**
 * Pure composition — all the math, warnings, triangulation, and data assembly
 * that used to live inside generateFullReport. Takes already-fetched external
 * data and produces the fullReportData object that gets persisted + rendered.
 *
 * The Claude call is the one async operation still inside; it's injected so
 * scenario tests can use a stub. The function never touches Prisma — fixture-
 * testable end-to-end without a test DB.
 */
export async function composeFullReport(
  report: Report,
  results: ReportFetchResults,
  aiGenerator: AiGenerator = generateDealDoctor
): Promise<Record<string, any>> {
  const { property, rates } = results
  const rentEstimate =
    results.rentEstimate.status === 'fulfilled' ? results.rentEstimate.value : null
  const saleComps =
    results.saleComps.status === 'fulfilled' ? results.saleComps.value : []
  const rentComps =
    results.rentComps.status === 'fulfilled' ? results.rentComps.value : []
  const marketSnapshot =
    results.marketSnapshot.status === 'fulfilled' ? results.marketSnapshot.value : null
  const climate =
    results.climate.status === 'fulfilled' && results.climate.value
      ? results.climate.value
      : null
  const locationSignals =
    results.locationSignals.status === 'fulfilled' ? results.locationSignals.value : null

  const askPrice = property.estimated_value
  const offerPrice = report.offerPrice ?? askPrice
  const downPaymentPct = report.downPaymentPct ?? 0.2
  const rehabBudget = report.rehabBudget ?? 0

  // Apply investor-rate premium based on strategy. PMMS is owner-occupied;
  // real DSCR / non-owner-occupied pricing runs higher. See rates.ts for rationale.
  const strategy = (report.strategy as Strategy) ?? 'LTR'
  const investorRate = applyInvestorPremium(rates.mortgage30yr, strategy)
  const rawRentAvm = rentEstimate?.estimated_rent || askPrice * 0.005

  // Student-housing heuristic: when the AVM is clearly a per-bedroom rate
  // (subdivision match or implausibly low yield), multiply by bedroom count
  // to get whole-property rent. ALL downstream math (cash flow, DSCR, 5yr
  // wealth, IRR, breakeven, sensitivity) then uses the corrected figure.
  const rentAdjustment = applyStudentHousingHeuristic({
    rentAvm: rawRentAvm,
    propertyValue: offerPrice,
    bedrooms: property.bedrooms,
    subdivision: property.subdivision,
  })
  const monthlyRent = rentAdjustment.effectiveRent
  const stateRules = STATE_RULES[report.state] || STATE_RULES['TX']

  // If climate is entirely unavailable (rare — it has its own null-safe paths),
  // fall back to $1,800/yr national-average homeowners insurance. Report still
  // generates; the climate section just won't render.
  const monthlyInsurance = climate
    ? Math.round(climate.estimatedAnnualInsurance / 12)
    : Math.round(1800 / 12)

  // Property tax: prefer actual county record from Rentcast, fall back to state avg × price.
  let monthlyPropertyTax: number
  let propertyTaxSource: 'county-record' | 'state-average'
  if (property.annual_property_tax && property.annual_property_tax > 0) {
    monthlyPropertyTax = Math.round(property.annual_property_tax / 12)
    propertyTaxSource = 'county-record'
  } else {
    monthlyPropertyTax = Math.round((offerPrice * stateRules.propertyTaxRate) / 12)
    propertyTaxSource = 'state-average'
  }

  const monthlyHOA = property.hoa_fee_monthly ?? 0
  const monthlyMaintenance = 150
  const monthlyExpenses = monthlyPropertyTax + monthlyInsurance + monthlyMaintenance + monthlyHOA

  const ltrMetrics = calculateDealMetrics(
    {
      purchasePrice: offerPrice,
      downPaymentPct,
      annualRate: investorRate,
      amortizationYears: 30,
      state: report.state,
      rehabBudget,
    },
    { estimatedMonthlyRent: monthlyRent, vacancyRate: 0.05, monthlyExpenses },
    report.state
  )

  // ARV from sale comps median — used for the 70% flip-rule offer calculation.
  const compValues = saleComps
    .map((c: any) => Number(c.estimated_value))
    .filter((v: number) => Number.isFinite(v) && v > 0)
    .sort((a: number, b: number) => a - b)
  const arvEstimate =
    compValues.length > 0 ? compValues[Math.floor(compValues.length / 2)] : undefined

  // Value triangulation — build a list of every independent signal we have
  // for the property's value. If they diverge by >25%, we flag low confidence.
  type ValueSignal = { label: string; value: number; source: string }
  const valueSignals: ValueSignal[] = []
  valueSignals.push({
    label: property.value_source === 'listing' ? 'Active listing price' : 'Rentcast AVM',
    value: property.estimated_value,
    source:
      property.value_source === 'listing'
        ? 'Current MLS listing'
        : property.value_source === 'avm'
        ? 'Rentcast automated value model'
        : property.value_source === 'tax-assessment'
        ? 'Tax assessment × 1.15'
        : property.value_source === 'last-sale-grown'
        ? 'Last sale grown at 3%/yr'
        : 'Unknown source',
  })
  if (arvEstimate) {
    valueSignals.push({
      label: 'Sale comps median',
      value: arvEstimate,
      source: `Median of ${compValues.length} recent sold comps (1-mile radius, same bed count)`,
    })
  }
  if (property.latest_tax_assessment && property.value_source !== 'tax-assessment') {
    valueSignals.push({
      label: 'Tax assessment × 1.15',
      value: Math.round(property.latest_tax_assessment * 1.15),
      source: 'County assessor records (assessments typically lag market ~15%)',
    })
  }
  if (property.last_sale_price && property.last_sale_date && property.value_source !== 'last-sale-grown') {
    const saleYear = new Date(property.last_sale_date).getFullYear()
    const yearsSinceSale = Math.max(0, new Date().getFullYear() - saleYear)
    if (yearsSinceSale > 0) {
      valueSignals.push({
        label: `Last sale grown ${yearsSinceSale}yr @ 3%`,
        value: Math.round(property.last_sale_price * Math.pow(1.03, yearsSinceSale)),
        source: `Sold ${saleYear} for $${property.last_sale_price.toLocaleString()}`,
      })
    }
  }

  const allValues = valueSignals.map((s) => s.value)
  if (property.value_range_low) allValues.push(property.value_range_low)
  if (property.value_range_high) allValues.push(property.value_range_high)
  const valueSpread =
    allValues.length > 1
      ? (Math.max(...allValues) - Math.min(...allValues)) / property.estimated_value
      : 0
  const valueConfidence: 'high' | 'medium' | 'low' =
    valueSpread < 0.1 ? 'high' : valueSpread < 0.25 ? 'medium' : 'low'

  const rentWarnings: string[] = []
  if (rentComps && rentComps.length >= 3) {
    const rentCompMedian = [...rentComps]
      .map((c: any) => Number(c.rent))
      .filter((v: number) => Number.isFinite(v) && v > 0)
      .sort((a: number, b: number) => a - b)[Math.floor(rentComps.length / 2)]
    if (rentCompMedian && monthlyRent < rentCompMedian * 0.75) {
      rentWarnings.push(
        `Rent AVM ($${Math.round(monthlyRent).toLocaleString()}/mo) is >25% below rent-comps median ($${Math.round(rentCompMedian).toLocaleString()}/mo) — AVM may have picked up lower-priced comps.`
      )
    }
  }

  const KNOWN_STUDENT_COMPLEXES = [
    'HUNTERS RIDGE',
    'ASHBY CROSSING',
    'SUNCHASE',
    'COPPER BEECH',
    'UNIVERSITY',
    'CAMPUS',
  ]
  const subdivisionUpper = (property.subdivision || '').toUpperCase()
  const isStudentHousing = KNOWN_STUDENT_COMPLEXES.some((p) => subdivisionUpper.includes(p))
  if (isStudentHousing) {
    rentWarnings.push(
      `Property is in "${property.subdivision}" — a known student-rental complex. Rent AVMs typically return per-bedroom rates here; whole-property rent is often 3-5× the reported figure.`
    )
  }

  const monthlyPITI = ltrMetrics.monthlyMortgagePayment + monthlyPropertyTax + monthlyInsurance
  const cashToClose = calculateCashToClose(offerPrice, downPaymentPct, rehabBudget, monthlyPITI)

  const clampGrowth = (x: number | null | undefined, fallback: number): number => {
    if (x == null || !Number.isFinite(x)) return fallback
    return Math.max(-0.05, Math.min(0.15, x))
  }
  const rentGrowthRate = clampGrowth(marketSnapshot?.rentGrowth12mo, 0.03)
  const appreciationRate = clampGrowth(marketSnapshot?.salePriceGrowth12mo, 0.03)

  const stateTaxGrowth = getStatePropertyTaxGrowth(report.state)
  const taxWeight = monthlyPropertyTax / monthlyExpenses
  const insWeight = monthlyInsurance / monthlyExpenses
  const otherWeight = 1 - taxWeight - insWeight
  const blendedExpenseGrowth =
    stateTaxGrowth * taxWeight + 0.06 * insWeight + 0.025 * otherWeight

  const projections = projectWealth({
    offerPrice,
    loanAmount: ltrMetrics.loanAmount,
    annualRate: investorRate,
    amortYears: 30,
    initialMonthlyRent: monthlyRent,
    vacancyRate: 0.05,
    initialMonthlyExpenses: monthlyExpenses,
    annualDepreciation: ltrMetrics.annualDepreciation,
    rentGrowthRate,
    appreciationRate,
    expenseGrowthRate: blendedExpenseGrowth,
    years: 5,
  })
  const year5 = projections[projections.length - 1]
  const irr5yr = calculateHoldPeriodIRR(cashToClose.totalCashToClose, projections)

  const financingAlternatives = calculateFinancingAlternatives({
    offerPrice,
    pmmsRate: rates.mortgage30yr,
    monthlyRent,
    vacancyRate: 0.05,
    monthlyExpenses,
    rehabBudget,
  })

  const sensitivity = calculateSensitivity({
    offerPrice,
    downPaymentPct,
    annualRate: investorRate,
    monthlyRent,
    vacancyRate: 0.05,
    monthlyExpenses,
    rehabBudget,
    annualDepreciation: ltrMetrics.annualDepreciation,
    cashToClose: cashToClose.totalCashToClose,
  })

  const strRevenue = estimateSTRRevenue(report.city, report.state, property.bedrooms)
  const strProjection = calculateSTRProjection({
    monthlyGrossRevenue: strRevenue,
    monthlyMortgagePayment: ltrMetrics.monthlyMortgagePayment,
    monthlyPropertyTax,
    monthlyInsuranceLTR: monthlyInsurance,
    monthlyLTRCashFlow: ltrMetrics.monthlyNetCashFlow,
  })

  const recommendedOffers = calculateRecommendedOffers({
    monthlyRent,
    vacancyRate: 0.05,
    annualRate: investorRate,
    downPaymentPct,
    rehabBudget,
    propertyTaxRate: stateRules.propertyTaxRate,
    monthlyInsurance,
    monthlyMaintenance,
    monthlyHOA,
    targetCoC: 0.08,
    targetIRR: 0.1,
  })

  // Deal Doctor AI narration. If the model fails (rate limit, quota exhausted,
  // network), we still return the rest of the report — the math and climate
  // sections stand on their own. Only the "3 fixes" section goes missing.
  let dealDoctor: DealDoctorOutput | null = null
  let dealDoctorError: string | null = null
  let dealDoctorErrorDetail: string | null = null
  try {
    dealDoctor = await aiGenerator(
      report.address,
      report.city,
      report.state,
      strategy as 'LTR' | 'STR' | 'FLIP',
      ltrMetrics,
      offerPrice,
      monthlyRent,
      investorRate,
      climate ?? undefined,
      property.bedrooms,
      arvEstimate,
      rehabBudget || undefined
    )
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status
    const apiError = err?.error ? JSON.stringify(err.error) : null
    const detail = [
      err?.constructor?.name,
      status ? `status=${status}` : null,
      err?.message,
      apiError,
    ]
      .filter(Boolean)
      .join(' · ')
    console.error('Deal Doctor AI failed (report still generated):', detail)
    dealDoctorErrorDetail = detail
    const isRateLimit =
      status === 429 || err?.message?.includes('429') || err?.message?.includes('quota')
    const isAuth = status === 401 || status === 403
    dealDoctorError = isRateLimit
      ? 'AI diagnosis temporarily unavailable — rate limit reached. Numbers below are unaffected.'
      : isAuth
      ? 'AI diagnosis unavailable — API credential issue. Numbers below are unaffected.'
      : 'AI diagnosis could not be generated. Numbers below are unaffected.'
  }

  return {
    generatedAt: new Date().toISOString(),
    property: {
      address: report.address,
      city: report.city,
      state: report.state,
      askPrice,
      offerPrice,
      downPaymentPct,
      rehabBudget,
      strategy: report.strategy ?? 'LTR',
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      sqft: property.square_feet,
      yearBuilt: property.year_built,
      propertyType: property.property_type,
      latitude: property.latitude,
      longitude: property.longitude,
    },
    rates: {
      mortgage30yr: rates.mortgage30yr,
      mortgage30yrInvestor: investorRate,
      investorPremiumBps: Math.round(INVESTOR_PREMIUM[strategy] * 10000),
      mortgage15yr: rates.mortgage15yr,
      fedFunds: rates.fedFundsRate,
    },
    breakeven: {
      price: calculateBreakEvenPrice(monthlyRent, investorRate),
      yourOffer: offerPrice,
      delta: calculateBreakEvenPrice(monthlyRent, investorRate) - offerPrice,
    },
    expenses: {
      monthlyPropertyTax,
      monthlyInsurance,
      monthlyMaintenance,
      monthlyHOA,
      monthlyTotal: monthlyExpenses,
      propertyTaxSource,
      hoaSource: monthlyHOA > 0 ? 'listing' : 'not-captured',
    },
    rentAdjustment: {
      applied: rentAdjustment.isMultiplied,
      perBedroomRent: rentAdjustment.perBedroomRent,
      bedroomsUsed: rentAdjustment.bedroomsUsed,
      effectiveRent: rentAdjustment.effectiveRent,
      reason: rentAdjustment.reason,
    },
    inputs: {
      monthlyRent,
      vacancyRate: 0.05,
      monthlyExpenses,
      annualRate: investorRate,
      amortYears: 30,
    },
    cashToClose,
    wealthProjection: {
      years: projections,
      hero: {
        totalWealthBuilt5yr: year5?.totalWealthBuilt ?? 0,
        cumulativeCashFlow5yr: year5?.cumulativeCashFlow ?? 0,
        equityFromPaydown5yr: year5?.equityFromPaydown ?? 0,
        equityFromAppreciation5yr: year5?.equityFromAppreciation ?? 0,
        cumulativeTaxShield5yr: year5?.cumulativeTaxShield ?? 0,
        irr5yr,
        propertyValue5yr: year5?.propertyValue ?? 0,
      },
      assumptions: {
        rentGrowthRate,
        appreciationRate,
        expenseGrowthRate: blendedExpenseGrowth,
        stateTaxGrowth,
        effectiveTaxRate: 0.28,
        saleCostPct: 0.06,
        rentGrowthSource: marketSnapshot?.rentGrowth12mo != null ? 'zip-12mo' : 'default-3pct',
        appreciationSource:
          marketSnapshot?.salePriceGrowth12mo != null ? 'zip-12mo' : 'default-3pct',
      },
    },
    financingAlternatives,
    sensitivity,
    recommendedOffers,
    strProjection,
    marketSnapshot,
    locationSignals,
    rentComps,
    climate,
    valueTriangulation: {
      signals: valueSignals,
      primaryValue: property.estimated_value,
      valueSource: property.value_source,
      valueRangeLow: property.value_range_low,
      valueRangeHigh: property.value_range_high,
      spreadPct: Math.round(valueSpread * 1000) / 10,
      confidence: valueConfidence,
    },
    rentWarnings,
    crossCheckLinks: {
      zillow: `https://www.google.com/search?q=${encodeURIComponent(`zillow ${report.address}`)}`,
      redfin: `https://www.google.com/search?q=${encodeURIComponent(`redfin ${report.address}`)}`,
      realtor: `https://www.google.com/search?q=${encodeURIComponent(`realtor.com ${report.address}`)}`,
    },
    ltr: ltrMetrics,
    dealDoctor,
    dealDoctorError,
    dealDoctorErrorDetail,
    comparableSales: saleComps.slice(0, 4),
    stateRules: {
      state: report.state,
      rentControl: stateRules.rentControl,
      landlordFriendly: stateRules.landlordFriendly,
      strNotes: stateRules.strNotes,
      propertyTaxRate: stateRules.propertyTaxRate,
    },
  }
}

/**
 * Orchestrator — reads the report row, fires all external fetches in
 * parallel, calls composeFullReport, and persists the result. This is the
 * function the payment webhook + debug-mode report endpoint call.
 */
export async function generateFullReport(uuid: string): Promise<void> {
  const report = await prisma.report.findUnique({ where: { id: uuid } })
  if (!report || !report.teaserData) return

  const rates = await getCurrentRates()
  const property = await searchProperty(report.address)
  if (!property) return

  const coords =
    typeof property.latitude === 'number' && typeof property.longitude === 'number'
      ? { lat: property.latitude, lng: property.longitude }
      : null

  const offerPriceForTax = report.offerPrice ?? property.estimated_value

  const [rentRes, salesRes, rentCompsRes, marketRes] = await Promise.allSettled([
    getRentEstimate(report.address, property.bedrooms),
    getComparableSales(report.city, report.state, property.bedrooms, coords, 1.0, {
      sqft: property.square_feet,
      value: property.estimated_value,
      propertyType: property.property_type,
    }),
    getRentComps(report.address, property.bedrooms, property.property_type),
    getMarketSnapshot(report.zipCode),
  ])

  for (const [name, result] of [
    ['rentEstimate', rentRes],
    ['saleComps', salesRes],
    ['rentComps', rentCompsRes],
    ['marketSnapshot', marketRes],
  ] as const) {
    if (result.status === 'rejected') {
      console.warn(`[reportGenerator] ${name} failed:`, result.reason?.message ?? result.reason)
    }
  }

  const [climateRes, locationRes] = await Promise.allSettled([
    getClimateAndInsurance(report.address, report.state, report.zipCode, offerPriceForTax),
    coords ? getLocationSignals(coords.lat, coords.lng) : Promise.resolve(null),
  ])

  if (climateRes.status === 'rejected') {
    console.warn('[reportGenerator] climate lookup failed:', climateRes.reason?.message)
  }
  if (locationRes.status === 'rejected') {
    console.warn('[reportGenerator] location signals failed:', locationRes.reason?.message)
  }

  const fullReportData = await composeFullReport(report, {
    property,
    rates,
    rentEstimate: rentRes,
    saleComps: salesRes,
    rentComps: rentCompsRes,
    marketSnapshot: marketRes,
    climate: climateRes,
    locationSignals: locationRes,
  })

  await prisma.report.update({
    where: { id: uuid },
    data: { fullReportData: JSON.stringify(fullReportData) },
  })
}
