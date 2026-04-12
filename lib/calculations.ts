// US mortgage math — standard MONTHLY compounding

export interface MortgageInputs {
  purchasePrice: number      // USD
  downPaymentPct: number     // e.g. 0.20 for 20%
  annualRate: number         // e.g. 0.065 for 6.5%
  amortizationYears: number  // typically 30 in US
  state: string
  rehabBudget?: number       // Upfront rehab capital — counts toward cash-in-deal for CoC
}

export interface RentalInputs {
  estimatedMonthlyRent: number
  vacancyRate: number        // e.g. 0.05 for 5%
  monthlyExpenses: number    // property tax + insurance + maintenance
  monthlyHOA?: number
}

export interface DealMetrics {
  // Mortgage
  monthlyMortgagePayment: number
  loanAmount: number

  // Cash flow
  monthlyNetCashFlow: number
  annualNetCashFlow: number

  // Returns
  capRate: number            // NOI / purchase price
  cashOnCashReturn: number   // annual cash flow / down payment
  noiAnnual: number

  // Debt service
  dscr: number               // NOI / annual debt service — lenders want >= 1.25
  ltv: number                // loan-to-value ratio

  // Renewal risk
  renewalSurvivalRate: number
  renewalScenarios: RenewalScenario[]

  // Depreciation (US: 27.5-year straight-line for residential)
  annualDepreciation: number
  estimatedTaxSaving: number
  afterTaxCashFlow: number

  // Verdict
  verdict: 'DEAL' | 'MARGINAL' | 'PASS'
  primaryFailureMode: string
  dealScore: number            // 0-100
}

export interface RenewalScenario {
  rate: number
  monthlyPayment: number
  monthlyCashFlow: number
  viable: boolean
}

// --- CORE MORTGAGE CALCULATION ---
// US mortgage: standard monthly compounding
export function calculateMortgage(
  principal: number,
  annualRate: number,
  amortizationYears: number
): number {
  const monthlyRate = annualRate / 12
  const n = amortizationYears * 12
  if (monthlyRate === 0) return principal / n
  const payment = principal * (monthlyRate * Math.pow(1 + monthlyRate, n)) /
                  (Math.pow(1 + monthlyRate, n) - 1)
  return Math.round(payment * 100) / 100
}

// --- DSCR CALCULATION ---
// Debt Service Coverage Ratio — lenders typically require >= 1.25
export function calculateDSCR(
  noiAnnual: number,
  annualDebtService: number
): number {
  if (annualDebtService <= 0) return 0
  return Math.round((noiAnnual / annualDebtService) * 100) / 100
}

// --- RENEWAL / REFI SCENARIOS ---
export function calculateRenewalScenarios(
  originalLoanAmount: number,
  contractRate: number,
  amortizationYears: number,
  termYears: number = 5,
  monthlyRent: number,
  vacancy: number,
  expenses: number
): RenewalScenario[] {
  const monthlyRate = contractRate / 12
  const termMonths = termYears * 12
  const originalPayment = calculateMortgage(originalLoanAmount, contractRate, amortizationYears)

  // Remaining balance at refi
  let balance = originalLoanAmount
  for (let i = 0; i < termMonths; i++) {
    const interestPayment = balance * monthlyRate
    const principalPayment = originalPayment - interestPayment
    balance -= principalPayment
  }

  const refiRates = [0.05, 0.055, 0.06, 0.065, 0.07, 0.075, 0.08]
  const remainingAmort = amortizationYears - termYears
  const effectiveRent = monthlyRent * (1 - vacancy)

  return refiRates.map(rate => {
    const payment = calculateMortgage(balance, rate, remainingAmort)
    const cashFlow = effectiveRent - payment - expenses
    return {
      rate,
      monthlyPayment: Math.round(payment),
      monthlyCashFlow: Math.round(cashFlow),
      viable: cashFlow >= -100
    }
  })
}

// --- BREAKEVEN OFFER PRICE ---
// Binary-search the purchase price at which monthly cash flow is ~$0 given current
// rent and rates. This is DealDoctor's flagship metric: "offer $X and it works."
// Assumes 20% down, 30yr amort, 1.5% annual property tax/insurance, $250/mo ops buffer.
// Invariant: CF(price) is monotonically decreasing — at low prices CF>0, at high CF<0.
// We search for the crossover: when CF>0 at mid, breakeven is ≥ mid (push low up);
// when CF<0, breakeven is < mid (pull high down).
export function calculateBreakEvenPrice(
  monthlyRent: number,
  annualRate: number,
): number {
  let low = 50000, high = 3000000
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2
    const loan = mid * 0.80
    const monthlyRate = annualRate / 12
    const n = 30 * 12
    const payment = loan * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1)
    const cf = monthlyRent * 0.95 - payment - (mid * 0.015 / 12) - 250
    if (cf > 0) low = mid; else high = mid
  }
  return Math.round((low + high) / 2 / 1000) * 1000
}

// --- DEPRECIATION CALCULATION ---
// US residential rental: 27.5-year straight-line on building value
// Land is not depreciable. Typically ~80% building, ~20% land.
export function calculateDepreciation(
  purchasePrice: number,
  annualRentalIncome: number,
  annualExpenses: number
): {
  buildingValue: number
  annualDepreciation: number
  estimatedTaxSaving: number
  afterTaxCashFlow: number
} {
  const buildingValue = purchasePrice * 0.80
  const annualDepreciation = Math.round(buildingValue / 27.5)

  const netRentalIncome = annualRentalIncome - annualExpenses
  // Depreciation can create a paper loss in US (unlike Canada's CCA rules)
  const taxSaving = Math.round(annualDepreciation * 0.28) // ~28% effective rate estimate

  return {
    buildingValue: Math.round(buildingValue),
    annualDepreciation,
    estimatedTaxSaving: taxSaving,
    afterTaxCashFlow: Math.round(netRentalIncome + taxSaving)
  }
}

// --- STATE RULES ---
export const STATE_RULES: Record<string, {
  name: string
  propertyTaxRate: number       // approximate effective rate
  rentControl: boolean
  landlordFriendly: boolean
  strNotes: string
}> = {
  TX: { name: 'Texas', propertyTaxRate: 0.018, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions. Check municipal rules.' },
  FL: { name: 'Florida', propertyTaxRate: 0.009, rentControl: false, landlordFriendly: true, strNotes: 'No statewide ban. Some cities restrict STR in residential zones.' },
  CA: { name: 'California', propertyTaxRate: 0.0073, rentControl: true, landlordFriendly: false, strNotes: 'Many cities restrict STR. LA, SF require permits. Prop 13 caps assessment increases.' },
  NY: { name: 'New York', propertyTaxRate: 0.017, rentControl: true, landlordFriendly: false, strNotes: 'NYC essentially bans most short-term rentals under 30 days. Strict rent stabilization.' },
  OH: { name: 'Ohio', propertyTaxRate: 0.016, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  GA: { name: 'Georgia', propertyTaxRate: 0.009, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions. Atlanta requires permits.' },
  NC: { name: 'North Carolina', propertyTaxRate: 0.008, rentControl: false, landlordFriendly: true, strNotes: 'Generally STR-friendly. Check HOA rules.' },
  TN: { name: 'Tennessee', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'Nashville requires permits for non-owner-occupied STR.' },
  AZ: { name: 'Arizona', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'State law preempts local STR bans. Very STR-friendly.' },
  CO: { name: 'Colorado', propertyTaxRate: 0.005, rentControl: false, landlordFriendly: true, strNotes: 'Denver requires STR license. Mountain towns may restrict.' },
  IN: { name: 'Indiana', propertyTaxRate: 0.008, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  MI: { name: 'Michigan', propertyTaxRate: 0.015, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR ban. Some lakeside communities restrict.' },
  PA: { name: 'Pennsylvania', propertyTaxRate: 0.015, rentControl: false, landlordFriendly: true, strNotes: 'Philadelphia requires STR license.' },
  IL: { name: 'Illinois', propertyTaxRate: 0.021, rentControl: true, landlordFriendly: false, strNotes: 'Chicago requires STR license and has unit cap.' },
  WA: { name: 'Washington', propertyTaxRate: 0.009, rentControl: true, landlordFriendly: false, strNotes: 'Seattle restricts STR to primary residences.' },
  NV: { name: 'Nevada', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'Las Vegas requires STR business license.' },
  MO: { name: 'Missouri', propertyTaxRate: 0.010, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  SC: { name: 'South Carolina', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'Generally STR-friendly. Beach communities may have rules.' },
}

// Extract state from US zip code (first digit mapping)
export function getStateFromZipCode(zipCode: string): string {
  const zip = zipCode.trim().replace(/\D/g, '')
  const first3 = parseInt(zip.substring(0, 3), 10)

  // Approximate zip-to-state mapping
  if (first3 >= 100 && first3 <= 149) return 'NY'
  if (first3 >= 150 && first3 <= 196) return 'PA'
  if (first3 >= 200 && first3 <= 205) return 'DC'
  if (first3 >= 206 && first3 <= 219) return 'MD'
  if (first3 >= 220 && first3 <= 246) return 'VA'
  if (first3 >= 247 && first3 <= 268) return 'WV'
  if (first3 >= 270 && first3 <= 289) return 'NC'
  if (first3 >= 290 && first3 <= 299) return 'SC'
  if (first3 >= 300 && first3 <= 319) return 'GA'
  if (first3 >= 320 && first3 <= 349) return 'FL'
  if (first3 >= 350 && first3 <= 369) return 'AL'
  if (first3 >= 370 && first3 <= 385) return 'TN'
  if (first3 >= 386 && first3 <= 397) return 'MS'
  if (first3 >= 400 && first3 <= 427) return 'KY'
  if (first3 >= 430 && first3 <= 458) return 'OH'
  if (first3 >= 460 && first3 <= 479) return 'IN'
  if (first3 >= 480 && first3 <= 499) return 'MI'
  if (first3 >= 500 && first3 <= 528) return 'IA'
  if (first3 >= 530 && first3 <= 549) return 'WI'
  if (first3 >= 550 && first3 <= 567) return 'MN'
  if (first3 >= 570 && first3 <= 577) return 'SD'
  if (first3 >= 580 && first3 <= 588) return 'ND'
  if (first3 >= 590 && first3 <= 599) return 'MT'
  if (first3 >= 600 && first3 <= 629) return 'IL'
  if (first3 >= 630 && first3 <= 658) return 'MO'
  if (first3 >= 660 && first3 <= 679) return 'KS'
  if (first3 >= 680 && first3 <= 693) return 'NE'
  if (first3 >= 700 && first3 <= 714) return 'LA'
  if (first3 >= 716 && first3 <= 729) return 'AR'
  if (first3 >= 730 && first3 <= 749) return 'OK'
  if (first3 >= 750 && first3 <= 799) return 'TX'
  if (first3 >= 800 && first3 <= 816) return 'CO'
  if (first3 >= 820 && first3 <= 831) return 'WY'
  if (first3 >= 832 && first3 <= 838) return 'ID'
  if (first3 >= 840 && first3 <= 847) return 'UT'
  if (first3 >= 850 && first3 <= 865) return 'AZ'
  if (first3 >= 870 && first3 <= 884) return 'NM'
  if (first3 >= 889 && first3 <= 898) return 'NV'
  if (first3 >= 900 && first3 <= 961) return 'CA'
  if (first3 >= 970 && first3 <= 979) return 'OR'
  if (first3 >= 980 && first3 <= 994) return 'WA'
  return 'TX' // Default fallback
}

// --- FULL DEAL METRICS ---
export function calculateDealMetrics(
  inputs: MortgageInputs,
  rental: RentalInputs,
  _state: string
): DealMetrics {
  const { purchasePrice, downPaymentPct, annualRate, amortizationYears, rehabBudget } = inputs
  const loanAmount = purchasePrice * (1 - downPaymentPct)
  const downPayment = purchasePrice * downPaymentPct
  const totalCashIn = downPayment + (rehabBudget || 0)

  // Mortgage payment
  const monthlyMortgagePayment = calculateMortgage(loanAmount, annualRate, amortizationYears)

  // Cash flow
  const effectiveMonthlyRent = rental.estimatedMonthlyRent * (1 - rental.vacancyRate)
  const monthlyNetCashFlow = effectiveMonthlyRent - monthlyMortgagePayment - rental.monthlyExpenses
  const annualNetCashFlow = monthlyNetCashFlow * 12

  // Returns
  const noiAnnual = (effectiveMonthlyRent - rental.monthlyExpenses) * 12
  const capRate = noiAnnual / purchasePrice
  const cashOnCashReturn = totalCashIn > 0 ? annualNetCashFlow / totalCashIn : 0

  // DSCR
  const annualDebtService = monthlyMortgagePayment * 12
  const dscr = calculateDSCR(noiAnnual, annualDebtService)
  const ltv = loanAmount / purchasePrice

  // Refi scenarios
  const renewalScenarios = calculateRenewalScenarios(
    loanAmount, annualRate, amortizationYears, 5,
    rental.estimatedMonthlyRent, rental.vacancyRate, rental.monthlyExpenses
  )
  const renewalSurvivalRate = renewalScenarios
    .filter(s => s.viable)
    .reduce((max, s) => Math.max(max, s.rate), annualRate)

  // Depreciation
  const depr = calculateDepreciation(purchasePrice, noiAnnual + annualDebtService, rental.monthlyExpenses * 12)

  // Verdict
  const { verdict, primaryFailureMode, dealScore } = classifyDeal(
    cashOnCashReturn, capRate, monthlyNetCashFlow, dscr
  )

  return {
    monthlyMortgagePayment: Math.round(monthlyMortgagePayment),
    loanAmount: Math.round(loanAmount),
    monthlyNetCashFlow: Math.round(monthlyNetCashFlow),
    annualNetCashFlow: Math.round(annualNetCashFlow),
    capRate: Math.round(capRate * 10000) / 100,
    cashOnCashReturn: Math.round(cashOnCashReturn * 10000) / 100,
    noiAnnual: Math.round(noiAnnual),
    dscr,
    ltv: Math.round(ltv * 100) / 100,
    renewalSurvivalRate,
    renewalScenarios,
    annualDepreciation: depr.annualDepreciation,
    estimatedTaxSaving: depr.estimatedTaxSaving,
    afterTaxCashFlow: depr.afterTaxCashFlow,
    verdict,
    primaryFailureMode,
    dealScore
  }
}

// All inputs are DECIMAL fractions (coc = 0.08 for 8%, capRate = 0.05 for 5%).
// Thresholds are expressed in the same units so the comparisons are consistent.
// Prior to 2026-04-12 this function had a units mismatch: thresholds were written
// as whole-percent (coc >= 8) but inputs are decimals — DEAL verdict was unreachable.
function classifyDeal(
  coc: number, capRate: number, monthlyCF: number, dscr: number
): { verdict: 'DEAL' | 'MARGINAL' | 'PASS', primaryFailureMode: string, dealScore: number } {
  const cocScore = Math.min(100, Math.max(0, (coc / 0.08) * 40))
  const capScore = Math.min(100, Math.max(0, (capRate / 0.05) * 30))
  const cfScore = Math.min(100, Math.max(0, ((monthlyCF + 500) / 1000) * 30))
  const dealScore = Math.round(cocScore + capScore + cfScore)

  let verdict: 'DEAL' | 'MARGINAL' | 'PASS'
  let primaryFailureMode: string

  if (coc >= 0.08 && monthlyCF >= 0 && dscr >= 1.25) {
    verdict = 'DEAL'
    primaryFailureMode = 'STRONG_DEAL'
  } else if (coc >= 0.04 && monthlyCF >= -300) {
    verdict = 'MARGINAL'
    if (dscr < 1.25) primaryFailureMode = 'DSCR_LOW'
    else if (monthlyCF < 0) primaryFailureMode = 'THIN_MARGIN'
    else primaryFailureMode = 'BELOW_TARGET'
  } else {
    verdict = 'PASS'
    if (monthlyCF < -500) primaryFailureMode = 'NEGATIVE_CASHFLOW'
    else if (capRate < 0.03) primaryFailureMode = 'OVERPRICED'
    else primaryFailureMode = 'POOR_RETURNS'
  }

  return { verdict, primaryFailureMode, dealScore }
}
