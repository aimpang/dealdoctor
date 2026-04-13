import { prisma } from './db'
import {
  searchProperty,
  getRentEstimate,
  getComparableSales,
  getRentComps,
  getMarketSnapshot,
} from './propertyApi'
import { getCurrentRates, applyInvestorPremium, INVESTOR_PREMIUM, type Strategy } from './rates'
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
import { generateDealDoctor, estimateSTRRevenue } from './dealDoctor'
import { getClimateAndInsurance } from './climateRisk'
import { getLocationSignals } from './locationSignals'

export async function generateFullReport(uuid: string): Promise<void> {
  const report = await prisma.report.findUnique({ where: { id: uuid } })
  if (!report || !report.teaserData) return

  const rates = await getCurrentRates()
  const property = await searchProperty(report.address)
  if (!property) return

  // Use Rentcast-provided lat/lng for proximity-based comp search — address-
  // adjacent comps (≤1mi) are far more predictive than city-wide bedroom medians.
  const coords =
    typeof property.latitude === 'number' && typeof property.longitude === 'number'
      ? { lat: property.latitude, lng: property.longitude }
      : null

  // Fetch rent estimate, sale comps, rent comps, and market snapshot in parallel.
  // Use allSettled so one failing endpoint (e.g., /markets quota-exhausted)
  // doesn't nuke the entire report. Each getter already returns null/[] on
  // failure, so the .reason branch here catches the rare thrown case
  // (RentcastQuotaError). The report degrades gracefully — a missing market
  // snapshot just hides that sidebar card, rather than failing the whole gen.
  const [rentRes, salesRes, rentCompsRes, marketRes] = await Promise.allSettled([
    getRentEstimate(report.address, property.bedrooms),
    getComparableSales(report.city, report.state, property.bedrooms, coords, 1.0),
    getRentComps(report.address, property.bedrooms),
    getMarketSnapshot(report.zipCode),
  ])
  const rentEstimate = rentRes.status === 'fulfilled' ? rentRes.value : null
  const saleComps = salesRes.status === 'fulfilled' ? salesRes.value : []
  const rentComps = rentCompsRes.status === 'fulfilled' ? rentCompsRes.value : []
  const marketSnapshot = marketRes.status === 'fulfilled' ? marketRes.value : null

  // Log per-endpoint failures so we can tell which Rentcast call failed in
  // diagnostics without the whole report tanking.
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

  const askPrice = property.estimated_value
  const offerPrice = report.offerPrice ?? askPrice
  const downPaymentPct = report.downPaymentPct ?? 0.20
  const rehabBudget = report.rehabBudget ?? 0

  // Apply investor-rate premium based on strategy. PMMS is owner-occupied;
  // real DSCR / non-owner-occupied pricing runs higher. See rates.ts for rationale.
  const strategy = (report.strategy as Strategy) ?? 'LTR'
  const investorRate = applyInvestorPremium(rates.mortgage30yr, strategy)
  const monthlyRent = rentEstimate?.estimated_rent || askPrice * 0.005
  const stateRules = STATE_RULES[report.state] || STATE_RULES['TX']

  // Climate + insurance (flood zone + state insurance + hazard scores)
  // + Location quality (walkability from Mapbox Tilequery) — run in parallel
  // since they're both network-bound on coordinates/address.
  // Run climate + location in parallel with resilient failure handling.
  // Climate must succeed (it drives insurance cost which drives cash flow);
  // if it throws, fall back to state averages via the null-safe branches.
  const [climateRes, locationRes] = await Promise.allSettled([
    getClimateAndInsurance(report.address, report.state, report.zipCode, offerPrice),
    coords ? getLocationSignals(coords.lat, coords.lng) : Promise.resolve(null),
  ])
  const climate =
    climateRes.status === 'fulfilled' && climateRes.value ? climateRes.value : null
  const locationSignals =
    locationRes.status === 'fulfilled' ? locationRes.value : null

  if (climateRes.status === 'rejected') {
    console.warn('[reportGenerator] climate lookup failed:', climateRes.reason?.message)
  }
  if (locationRes.status === 'rejected') {
    console.warn('[reportGenerator] location signals failed:', locationRes.reason?.message)
  }

  // If climate is entirely unavailable (rare — it has its own null-safe paths),
  // fall back to $1,800/yr national-average homeowners insurance. Report still
  // generates; the climate section just won't render.
  const monthlyInsurance = climate
    ? Math.round(climate.estimatedAnnualInsurance / 12)
    : Math.round(1800 / 12)

  // Property tax: prefer actual county record from Rentcast, fall back to state avg × price.
  // Source label lets the UI attribute the number honestly.
  let monthlyPropertyTax: number
  let propertyTaxSource: 'county-record' | 'state-average'
  if (property.annual_property_tax && property.annual_property_tax > 0) {
    monthlyPropertyTax = Math.round(property.annual_property_tax / 12)
    propertyTaxSource = 'county-record'
  } else {
    monthlyPropertyTax = Math.round((offerPrice * stateRules.propertyTaxRate) / 12)
    propertyTaxSource = 'state-average'
  }

  // HOA: only included if Rentcast returned it. Condo/townhome without captured HOA
  // is a known gap — flagged in the UI so the user adds it manually if needed.
  const monthlyHOA = property.hoa_fee_monthly ?? 0
  const monthlyMaintenance = 150
  const monthlyExpenses = monthlyPropertyTax + monthlyInsurance + monthlyMaintenance + monthlyHOA

  const ltrMetrics = calculateDealMetrics(
    {
      purchasePrice: offerPrice,
      downPaymentPct,
      annualRate: investorRate, // was owner-occupied PMMS — now strategy-adjusted
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
    compValues.length > 0
      ? compValues[Math.floor(compValues.length / 2)]
      : undefined

  // Value triangulation — build a list of every independent signal we have
  // for the property's value. If they diverge by >25%, we flag low confidence
  // so buyers know the AVM is uncertain for this property.
  type ValueSignal = { label: string; value: number; source: string }
  const valueSignals: ValueSignal[] = []
  valueSignals.push({
    label: property.value_source === 'listing' ? 'Active listing price' : 'Rentcast AVM',
    value: property.estimated_value,
    source:
      property.value_source === 'listing' ? 'Current MLS listing' :
      property.value_source === 'avm' ? 'Rentcast automated value model' :
      property.value_source === 'tax-assessment' ? 'Tax assessment × 1.15' :
      property.value_source === 'last-sale-grown' ? 'Last sale grown at 3%/yr' :
      'Unknown source',
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

  // Confidence band: spread / primary value. <10% = high, <25% = medium, else low.
  const allValues = valueSignals.map((s) => s.value)
  const valueSpread =
    allValues.length > 1
      ? (Math.max(...allValues) - Math.min(...allValues)) / property.estimated_value
      : 0
  const valueConfidence: 'high' | 'medium' | 'low' =
    valueSpread < 0.10 ? 'high' : valueSpread < 0.25 ? 'medium' : 'low'

  // Cross-check rent vs sale-comps. Our rent AVM can mis-fire on student-
  // rental / per-room comps; if the annual rent yield is way off the
  // typical-for-this-market range, flag it. Note: the existing preview-side
  // rent-suspect warning handles the absolute-yield case. This is an
  // additional signal focused on the AVM vs manual-comps spread.
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

  // Student-housing / known-bad patterns. Small curated list — grows as we
  // find cases. When matched, downgrades confidence hard because rent AVMs
  // almost always return per-bedroom rates for these.
  const KNOWN_STUDENT_COMPLEXES = [
    'HUNTERS RIDGE',    // JMU, Harrisonburg VA
    'ASHBY CROSSING',   // JMU, Harrisonburg VA
    'SUNCHASE',         // JMU, Harrisonburg VA
    'COPPER BEECH',     // national student-housing brand
    'UNIVERSITY',       // often student-oriented
    'CAMPUS',
  ]
  const subdivisionUpper = (property.subdivision || '').toUpperCase()
  const isStudentHousing = KNOWN_STUDENT_COMPLEXES.some((p) =>
    subdivisionUpper.includes(p)
  )
  if (isStudentHousing) {
    rentWarnings.push(
      `Property is in "${property.subdivision}" — a known student-rental complex. Rent AVMs typically return per-bedroom rates here; whole-property rent is often 3-5× the reported figure.`
    )
  }

  // Cash-to-close: the full capital required to walk into closing.
  // monthlyPITI = principal-interest + tax + insurance (ignoring HOA/maint for reserves,
  // matching standard lender reserve calc which uses PITI not PITIA).
  const monthlyPITI = ltrMetrics.monthlyMortgagePayment + monthlyPropertyTax + monthlyInsurance
  const cashToClose = calculateCashToClose(offerPrice, downPaymentPct, rehabBudget, monthlyPITI)

  // 5-year wealth projection — cash flow + paydown + appreciation + tax shield.
  // When we have zip-level market data from Rentcast, use the actual 12-month
  // rent and price growth instead of hardcoded 3%. Clamped to a sane band so
  // a single wild data point can't produce an $8M projection.
  const clampGrowth = (x: number | null | undefined, fallback: number): number => {
    if (x == null || !Number.isFinite(x)) return fallback
    return Math.max(-0.05, Math.min(0.15, x))
  }
  const rentGrowthRate = clampGrowth(marketSnapshot?.rentGrowth12mo, 0.03)
  const appreciationRate = clampGrowth(marketSnapshot?.salePriceGrowth12mo, 0.03)

  // Blended expense growth: property tax grows at state-specific rate (Prop 13
  // in CA, no cap in TX, etc), insurance at ~6%/yr (recent trend), maintenance
  // at ~2.5%/yr. Weight by each component's share of total monthly expenses.
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

  // Financing alternatives — same property, 3 capital structures side-by-side
  const financingAlternatives = calculateFinancingAlternatives({
    offerPrice,
    pmmsRate: rates.mortgage30yr,
    monthlyRent,
    vacancyRate: 0.05,
    monthlyExpenses,
    rehabBudget,
  })

  // Sensitivity — rent, rate, expenses, and appreciation swings vs base
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

  // STR projection — compares Airbnb/VRBO P&L against LTR using our bedroom-aware
  // STR revenue estimate and STR-specific opex ratios (management + cleaning + utilities).
  const strRevenue = estimateSTRRevenue(report.city, report.state, property.bedrooms)
  const strProjection = calculateSTRProjection({
    monthlyGrossRevenue: strRevenue,
    monthlyMortgagePayment: ltrMetrics.monthlyMortgagePayment,
    monthlyPropertyTax,
    monthlyInsuranceLTR: monthlyInsurance,
    monthlyLTRCashFlow: ltrMetrics.monthlyNetCashFlow,
  })

  // Recommended max offers for three target outcomes
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
    targetIRR: 0.10,
  })

  // Deal Doctor AI narration. If the model fails (rate limit, quota exhausted,
  // network), we still return the rest of the report — the math and climate
  // sections stand on their own. Only the "3 fixes" section goes missing.
  let dealDoctor = null
  let dealDoctorError: string | null = null
  try {
    dealDoctor = await generateDealDoctor(
      report.address, report.city, report.state,
      strategy as 'LTR' | 'STR' | 'FLIP',
      ltrMetrics, offerPrice, monthlyRent, investorRate,
      climate,
      property.bedrooms,
      arvEstimate,
      rehabBudget || undefined
    )
  } catch (err: any) {
    console.error('Deal Doctor AI failed (report still generated):', err?.message)
    dealDoctorError = err?.message?.includes('429') || err?.message?.includes('quota')
      ? 'AI diagnosis temporarily unavailable — rate limit reached. Numbers below are unaffected.'
      : 'AI diagnosis could not be generated. Numbers below are unaffected.'
  }

  const fullReportData = {
    generatedAt: new Date().toISOString(),
    property: {
      address: report.address,
      city: report.city,
      state: report.state,
      askPrice,                 // listing price — for reference
      offerPrice,                // user's actual offer
      downPaymentPct,
      rehabBudget,
      strategy: report.strategy ?? 'LTR',
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      sqft: property.square_feet,
      yearBuilt: property.year_built,
      propertyType: property.property_type,
    },
    rates: {
      mortgage30yr: rates.mortgage30yr,          // owner-occupied PMMS (reference)
      mortgage30yrInvestor: investorRate,        // strategy-adjusted, used by the math
      investorPremiumBps: Math.round(INVESTOR_PREMIUM[strategy] * 10000),
      mortgage15yr: rates.mortgage15yr,
      fedFunds: rates.fedFundsRate,
    },
    breakeven: {
      // Breakeven must use the investor rate — otherwise the "walk-away price" is a lie.
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
      propertyTaxSource,              // 'county-record' | 'state-average'
      hoaSource: monthlyHOA > 0 ? 'listing' : 'not-captured',
    },
    // Raw underwriting inputs — needed by interactive UI (rehab estimator, what-if tools)
    // so they can re-run calculations without re-deriving from NOI.
    inputs: {
      monthlyRent,
      vacancyRate: 0.05,
      monthlyExpenses,
      annualRate: investorRate,
      amortYears: 30,
    },
    cashToClose,                      // down + closing + inspection + reserves + rehab
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
        appreciationSource: marketSnapshot?.salePriceGrowth12mo != null ? 'zip-12mo' : 'default-3pct',
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
    // Multi-source value triangulation + data-quality signals
    valueTriangulation: {
      signals: valueSignals,
      primaryValue: property.estimated_value,
      valueSource: property.value_source,
      valueRangeLow: property.value_range_low,
      valueRangeHigh: property.value_range_high,
      spreadPct: Math.round(valueSpread * 1000) / 10, // as percentage
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
    comparableSales: saleComps.slice(0, 4),
    stateRules: {
      state: report.state,
      rentControl: stateRules.rentControl,
      landlordFriendly: stateRules.landlordFriendly,
      strNotes: stateRules.strNotes,
      propertyTaxRate: stateRules.propertyTaxRate,
    }
  }

  await prisma.report.update({
    where: { id: uuid },
    data: { fullReportData: JSON.stringify(fullReportData) }
  })
}
