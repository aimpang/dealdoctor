import { prisma } from './db'
import { searchProperty, getRentEstimate, getComparableSales } from './propertyApi'
import { getCurrentRates } from './rates'
import {
  calculateDealMetrics,
  calculateBreakEvenPrice,
  STATE_RULES
} from './calculations'
import { generateDealDoctor } from './dealDoctor'
import { getClimateAndInsurance } from './climateRisk'

export async function generateFullReport(uuid: string): Promise<void> {
  const report = await prisma.report.findUnique({ where: { id: uuid } })
  if (!report || !report.teaserData) return

  const rates = await getCurrentRates()
  const property = await searchProperty(report.address)
  if (!property) return

  const rentEstimate = await getRentEstimate(report.address, property.bedrooms)
  const comps = await getComparableSales(report.city, report.state, property.bedrooms)

  const askPrice = property.estimated_value
  const offerPrice = report.offerPrice ?? askPrice
  const downPaymentPct = report.downPaymentPct ?? 0.20
  const rehabBudget = report.rehabBudget ?? 0
  const monthlyRent = rentEstimate?.estimated_rent || askPrice * 0.005
  const stateRules = STATE_RULES[report.state] || STATE_RULES['TX']

  // Climate + insurance (real estimate based on state + flood zone + dwelling value)
  const climate = await getClimateAndInsurance(
    report.address, report.state, report.zipCode, offerPrice
  )
  const monthlyInsurance = Math.round(climate.estimatedAnnualInsurance / 12)
  const monthlyPropertyTax = Math.round(offerPrice * stateRules.propertyTaxRate / 12)
  const monthlyMaintenance = 150
  const monthlyExpenses = monthlyPropertyTax + monthlyInsurance + monthlyMaintenance

  const ltrMetrics = calculateDealMetrics(
    {
      purchasePrice: offerPrice,
      downPaymentPct,
      annualRate: rates.mortgage30yr,
      amortizationYears: 30,
      state: report.state,
      rehabBudget,
    },
    { estimatedMonthlyRent: monthlyRent, vacancyRate: 0.05, monthlyExpenses },
    report.state
  )

  // ARV from sale comps median — used for the 70% flip-rule offer calculation.
  // Filter out zeros/nulls, take median of remaining values.
  const compValues = comps
    .map((c: any) => Number(c.estimated_value))
    .filter((v: number) => Number.isFinite(v) && v > 0)
    .sort((a: number, b: number) => a - b)
  const arvEstimate =
    compValues.length > 0
      ? compValues[Math.floor(compValues.length / 2)]
      : undefined

  // Deal Doctor AI narration uses offer, rate, climate, bedrooms, ARV, and rehab
  // as concrete anchors so the model cites specifics rather than giving generic advice.
  const dealDoctor = await generateDealDoctor(
    report.address, report.city, report.state,
    (report.strategy as 'LTR' | 'STR' | 'FLIP') ?? 'LTR',
    ltrMetrics, offerPrice, monthlyRent, rates.mortgage30yr,
    climate,
    property.bedrooms,
    arvEstimate,
    rehabBudget || undefined
  )

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
      mortgage30yr: rates.mortgage30yr,
      mortgage15yr: rates.mortgage15yr,
      fedFunds: rates.fedFundsRate,
    },
    breakeven: {
      price: calculateBreakEvenPrice(monthlyRent, rates.mortgage30yr),
      yourOffer: offerPrice,
      // Positive = offer is below breakeven (good); negative = above (bad)
      delta: calculateBreakEvenPrice(monthlyRent, rates.mortgage30yr) - offerPrice,
    },
    expenses: {
      monthlyPropertyTax,
      monthlyInsurance,
      monthlyMaintenance,
      monthlyTotal: monthlyExpenses,
    },
    climate,
    ltr: ltrMetrics,
    dealDoctor,
    comparableSales: comps.slice(0, 4),
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
