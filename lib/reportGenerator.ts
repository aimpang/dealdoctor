import { prisma } from './db'
import { searchProperty, getRentEstimate, getComparableSales } from './propertyApi'
import { getCurrentRates } from './rates'
import {
  calculateDealMetrics,
  STATE_RULES
} from './calculations'
import { generateDealDoctor } from './dealDoctor'

export async function generateFullReport(uuid: string): Promise<void> {
  const report = await prisma.report.findUnique({ where: { id: uuid } })
  if (!report || !report.teaserData) return

  const rates = await getCurrentRates()
  const property = await searchProperty(report.address)
  if (!property) return

  const rentEstimate = await getRentEstimate(report.address, property.bedrooms)
  const comps = await getComparableSales(report.city, report.state, property.bedrooms)

  const askPrice = property.estimated_value
  const monthlyRent = rentEstimate?.estimated_rent || askPrice * 0.005
  const stateRules = STATE_RULES[report.state] || STATE_RULES['TX']
  const monthlyExpenses = Math.round(askPrice * stateRules.propertyTaxRate / 12) + 200  // tax + insurance + maintenance

  // Calculate LTR metrics
  const ltrMetrics = calculateDealMetrics(
    { purchasePrice: askPrice, downPaymentPct: 0.20, annualRate: rates.mortgage30yr, amortizationYears: 30, state: report.state },
    { estimatedMonthlyRent: monthlyRent, vacancyRate: 0.05, monthlyExpenses },
    report.state
  )

  // Generate Deal Doctor for LTR (primary strategy)
  const dealDoctor = await generateDealDoctor(
    report.address, report.city, report.state,
    'LTR', ltrMetrics, askPrice, monthlyRent, rates.mortgage30yr
  )

  const fullReportData = {
    generatedAt: new Date().toISOString(),
    property: {
      address: report.address,
      city: report.city,
      state: report.state,
      askPrice,
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
