import { prisma } from './db'
import {
  searchProperty,
  getRentEstimate,
  getComparableSales,
  getRentComps,
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
  STATE_RULES,
} from './calculations'
import { generateDealDoctor } from './dealDoctor'
import { getClimateAndInsurance } from './climateRisk'

export async function generateFullReport(uuid: string): Promise<void> {
  const report = await prisma.report.findUnique({ where: { id: uuid } })
  if (!report || !report.teaserData) return

  const rates = await getCurrentRates()
  const property = await searchProperty(report.address)
  if (!property) return

  // Fetch rent estimate, sale comps, and rent comps in parallel.
  // Rent comps are the #1 trust gap — users want to see the neighbors we priced against.
  const [rentEstimate, saleComps, rentComps] = await Promise.all([
    getRentEstimate(report.address, property.bedrooms),
    getComparableSales(report.city, report.state, property.bedrooms),
    getRentComps(report.address, property.bedrooms),
  ])

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

  // Climate + insurance (real estimate based on state + flood zone + dwelling value)
  const climate = await getClimateAndInsurance(
    report.address, report.state, report.zipCode, offerPrice
  )
  const monthlyInsurance = Math.round(climate.estimatedAnnualInsurance / 12)

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

  // Cash-to-close: the full capital required to walk into closing.
  // monthlyPITI = principal-interest + tax + insurance (ignoring HOA/maint for reserves,
  // matching standard lender reserve calc which uses PITI not PITIA).
  const monthlyPITI = ltrMetrics.monthlyMortgagePayment + monthlyPropertyTax + monthlyInsurance
  const cashToClose = calculateCashToClose(offerPrice, downPaymentPct, rehabBudget, monthlyPITI)

  // 5-year wealth projection — cash flow + paydown + appreciation + tax shield
  const projections = projectWealth({
    offerPrice,
    loanAmount: ltrMetrics.loanAmount,
    annualRate: investorRate,
    amortYears: 30,
    initialMonthlyRent: monthlyRent,
    vacancyRate: 0.05,
    initialMonthlyExpenses: monthlyExpenses,
    annualDepreciation: ltrMetrics.annualDepreciation,
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
        rentGrowthRate: 0.03,
        appreciationRate: 0.03,
        expenseGrowthRate: 0.025,
        effectiveTaxRate: 0.28,
        saleCostPct: 0.06,
      },
    },
    financingAlternatives,
    sensitivity,
    recommendedOffers,
    rentComps,
    climate,
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
