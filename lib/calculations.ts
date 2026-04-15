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
// Bisection solver for the price that produces CF ≥ 0 on a long-term rental.
// Invariant: CF(price) is monotonically decreasing — at low prices CF>0, at high CF<0.
// We search for the crossover: when CF>0 at mid, breakeven is ≥ mid (push low up);
// when CF<0, breakeven is < mid (pull high down).
//
// `opts` lets callers pass the actual deal inputs — state-specific property tax
// rate, climate-driven insurance, HOA, maintenance, and down-payment pct. When
// omitted the defaults approximate a generic 20% down SFR (1% tax rate, $125
// insurance, $150 maintenance, no HOA) — kept so legacy callers still work but
// the report pipeline now passes real numbers.
export function calculateBreakEvenPrice(
  monthlyRent: number,
  annualRate: number,
  opts: {
    downPaymentPct?: number
    propertyTaxRate?: number          // decimal, e.g. 0.021 for IL
    monthlyInsurance?: number         // flat $/mo
    monthlyHOA?: number               // flat $/mo
    monthlyMaintenance?: number       // flat $/mo
    offerPrice?: number               // subject price — sets solver ceiling to 2× so $3M+ luxury properties aren't clamped
  } = {}
): number {
  const downPaymentPct = opts.downPaymentPct ?? 0.20
  const propertyTaxRate = opts.propertyTaxRate ?? 0.010
  const monthlyInsurance = opts.monthlyInsurance ?? 125
  const monthlyHOA = opts.monthlyHOA ?? 0
  const monthlyMaintenance = opts.monthlyMaintenance ?? 150

  // Dynamic high ceiling — pre-fix this was a flat $3M, which clamped every
  // luxury property and any solver on a $3M+ subject. Always keep 2× the
  // subject price as headroom so the crossover is reachable.
  let low = 50000
  let high = Math.max(3_000_000, (opts.offerPrice ?? 0) * 2)
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2
    const loan = mid * (1 - downPaymentPct)
    const monthlyRate = annualRate / 12
    const n = 30 * 12
    const payment = loan * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1)
    const fixedExpenses = monthlyInsurance + monthlyHOA + monthlyMaintenance
    const cf = monthlyRent * 0.95 - payment - (mid * propertyTaxRate / 12) - fixedExpenses
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

// --- CASH TO CLOSE ---
// What a buyer actually needs liquid to walk into closing. Investors underwrite
// from total capital required, not just "20% down." Lenders also expect 6 months
// of PITI in reserves — many pre-approvals quietly assume this.
export interface CashToCloseBreakdown {
  downPayment: number
  closingCosts: number          // ~2.5% of offer (title, origination, escrow setup)
  // Buyer-side transfer / recordation tax for jurisdictions that levy one
  // (NYC ~1.825%, DC 1.45%, Philly 2.14%, Chicago 0.75%, Baltimore 1.5%).
  // Zero for markets where it's folded into the 2.5% closing lump (TX/FL/etc).
  transferTax: number
  inspectionAndAppraisal: number // typically $800 inspection + $600 appraisal
  reserves: number              // 6 months PITI held liquid per lender guidance
  rehabBudget: number           // passed through unchanged
  totalCashToClose: number
}

export function calculateCashToClose(
  offerPrice: number,
  downPaymentPct: number,
  rehabBudget: number,
  monthlyPITI: number,
  closingCostPct: number = 0.025,
  reserveMonths: number = 6,
  transferTaxRate: number = 0
): CashToCloseBreakdown {
  const downPayment = Math.round(offerPrice * downPaymentPct)
  const closingCosts = Math.round(offerPrice * closingCostPct)
  const transferTax = Math.round(offerPrice * transferTaxRate)
  const inspectionAndAppraisal = 1500
  const reserves = Math.round(monthlyPITI * reserveMonths)
  const totalCashToClose = downPayment + closingCosts + transferTax + inspectionAndAppraisal + reserves + rehabBudget
  return { downPayment, closingCosts, transferTax, inspectionAndAppraisal, reserves, rehabBudget, totalCashToClose }
}

// --- N-YEAR WEALTH PROJECTION ---
// Investors don't buy for year-1 cash flow — they buy for total wealth built
// over a hold period: cash flow + principal paydown + appreciation + tax shield.
// Default assumptions are intentionally modest so the projection under-promises:
//   rentGrowth 3%/yr (BLS shelter CPI long-run avg)
//   appreciation 3%/yr (below recent boom, above long-run 2.5% real)
//   expenseGrowth 2.5%/yr
//   effectiveTaxRate 28% on depreciation shield
export interface YearProjection {
  year: number
  annualRent: number
  annualExpenses: number
  annualCashFlow: number
  cumulativeCashFlow: number
  propertyValue: number
  loanBalance: number
  equityFromPaydown: number
  equityFromAppreciation: number
  annualTaxShield: number      // dep × effectiveTaxRate (realized annually)
  cumulativeTaxShield: number
  // Depreciation claimed through year Y — forms the basis for Section 1250
  // unrecaptured gain if the property is sold.
  cumulativeDepreciation: number
  // Contingent tax owed at sale: 25% of cumulativeDepreciation (IRS
  // unrecaptured §1250 rate). Credited as wealth during hold via tax shield,
  // then owed back at exit unless the investor 1031s.
  depreciationRecaptureTax: number
  totalWealthBuilt: number     // cumCF + equityPaydown + equityAppreciation + cumTaxShield − recaptureTax
}

// IRS unrecaptured §1250 gain rate — flat 25% on depreciation claimed,
// triggered at sale (absent a 1031 exchange). Applied both to year-N IRR
// sale proceeds and to the wealth projection so the user sees the real
// net-of-recapture figure, not the gross tax-shield overstatement.
export const DEPRECIATION_RECAPTURE_RATE = 0.25

export function projectWealth(params: {
  offerPrice: number
  loanAmount: number
  annualRate: number
  amortYears: number
  initialMonthlyRent: number
  vacancyRate: number
  initialMonthlyExpenses: number
  annualDepreciation: number
  rentGrowthRate?: number
  appreciationRate?: number
  expenseGrowthRate?: number
  effectiveTaxRate?: number
  years?: number
}): YearProjection[] {
  const {
    offerPrice,
    loanAmount,
    annualRate,
    amortYears,
    initialMonthlyRent,
    vacancyRate,
    initialMonthlyExpenses,
    annualDepreciation,
    rentGrowthRate = 0.03,
    appreciationRate = 0.03,
    expenseGrowthRate = 0.025,
    effectiveTaxRate = 0.28,
    years = 5,
  } = params

  const monthlyRate = annualRate / 12
  const n = amortYears * 12
  const monthlyPayment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, n)) /
    (Math.pow(1 + monthlyRate, n) - 1)

  let balance = loanAmount
  let cumCashFlow = 0
  let cumTaxShield = 0
  const result: YearProjection[] = []

  for (let y = 1; y <= years; y++) {
    // Amortize this year month-by-month to track exact principal paydown
    for (let m = 0; m < 12; m++) {
      const interest = balance * monthlyRate
      const principal = monthlyPayment - interest
      balance -= principal
    }

    const rentMult = Math.pow(1 + rentGrowthRate, y - 1)
    const expMult = Math.pow(1 + expenseGrowthRate, y - 1)
    const annualRent = initialMonthlyRent * rentMult * (1 - vacancyRate) * 12
    const annualExpenses = initialMonthlyExpenses * expMult * 12
    const annualCashFlow = annualRent - annualExpenses - (monthlyPayment * 12)
    cumCashFlow += annualCashFlow

    const propertyValue = offerPrice * Math.pow(1 + appreciationRate, y)
    const equityFromPaydown = loanAmount - balance
    const equityFromAppreciation = propertyValue - offerPrice

    const taxShield = annualDepreciation * effectiveTaxRate
    cumTaxShield += taxShield

    // Depreciation recapture: the investor claimed `annualDepreciation × y`
    // of deductions through year Y; at sale, IRS taxes that amount at 25%
    // (unrecaptured §1250). We credit the shield yearly and owe it back
    // here so "wealth if sold at year Y" is honest about the tax bill.
    const cumulativeDepreciation = annualDepreciation * y
    const depreciationRecaptureTax = cumulativeDepreciation * DEPRECIATION_RECAPTURE_RATE

    const totalWealth =
      cumCashFlow +
      equityFromPaydown +
      equityFromAppreciation +
      cumTaxShield -
      depreciationRecaptureTax

    result.push({
      year: y,
      annualRent: Math.round(annualRent),
      annualExpenses: Math.round(annualExpenses),
      annualCashFlow: Math.round(annualCashFlow),
      cumulativeCashFlow: Math.round(cumCashFlow),
      propertyValue: Math.round(propertyValue),
      loanBalance: Math.round(balance),
      equityFromPaydown: Math.round(equityFromPaydown),
      equityFromAppreciation: Math.round(equityFromAppreciation),
      annualTaxShield: Math.round(taxShield),
      cumulativeTaxShield: Math.round(cumTaxShield),
      cumulativeDepreciation: Math.round(cumulativeDepreciation),
      depreciationRecaptureTax: Math.round(depreciationRecaptureTax),
      totalWealthBuilt: Math.round(totalWealth),
    })
  }

  return result
}

// --- IRR (internal rate of return) ---
// Newton-Raphson on NPV. Returns the annualized rate (as a decimal, e.g. 0.124 = 12.4%)
// at which the sum of discounted cash flows equals zero. Standard institutional metric.
//
// Returns NaN when the scenario has no meaningful IRR — no sign change in flows,
// non-convergence, or Newton pinning at the wild-swing guardrail. Callers must use
// Number.isFinite() to gate display; previously we returned the clamp ceiling of 10
// which rendered as "1000%" on deeply-negative-equity scenarios.
export function findIRR(flows: number[], guess: number = 0.10): number {
  if (flows.length < 2) return 0
  // IRR requires at least one sign change — without it no rate zeros the NPV.
  // This is the first gate deeply-negative-equity scenarios fail.
  const hasPositive = flows.some((f) => f > 0)
  const hasNegative = flows.some((f) => f < 0)
  if (!hasPositive || !hasNegative) return NaN

  let rate = guess
  let converged = false
  for (let iter = 0; iter < 200; iter++) {
    let npv = 0
    let dnpv = 0
    for (let t = 0; t < flows.length; t++) {
      const denom = Math.pow(1 + rate, t)
      npv += flows[t] / denom
      if (t > 0) dnpv -= (t * flows[t]) / (denom * (1 + rate))
    }
    if (Math.abs(npv) < 0.01) {
      converged = true
      break
    }
    if (Math.abs(dnpv) < 1e-10) break // avoid divide by zero
    const next = rate - npv / dnpv
    if (!Number.isFinite(next)) break
    rate = Math.max(-0.99, Math.min(10, next)) // clamp wild swings
  }
  if (!converged) return NaN
  // If Newton pinned at the guardrail, that's numerical failure, not a real answer.
  if (rate >= 9.99 || rate <= -0.98) return NaN
  return Math.round(rate * 10000) / 10000
}

// IRR over a hold period, selling at the end at projected value minus selling
// costs (6% = realtor + closing). Inputs tie together cashToClose, yearly cash
// flows, the sale proceeds at year N.
export function calculateHoldPeriodIRR(
  cashToClose: number,
  projections: YearProjection[],
  saleCostPct: number = 0.06
): number {
  if (projections.length === 0) return 0
  const flows: number[] = [-cashToClose]
  for (let i = 0; i < projections.length - 1; i++) {
    flows.push(projections[i].annualCashFlow)
  }
  const finalYear = projections[projections.length - 1]
  // Sale proceeds = market price − 6% selling cost − loan payoff − §1250
  // depreciation recapture (25% of depreciation claimed during the hold).
  // Without the recapture deduction IRR overstated returns on every deal
  // that wasn't sold under a 1031 exchange.
  const saleProceeds =
    finalYear.propertyValue * (1 - saleCostPct) -
    finalYear.loanBalance -
    finalYear.depreciationRecaptureTax
  flows.push(finalYear.annualCashFlow + saleProceeds)
  return findIRR(flows)
}

// --- FINANCING ALTERNATIVES ---
// Side-by-side comparison of capital structures for the same property. The
// strategy (LTR/STR/FLIP) determines the base investor premium; financing type
// layers on its own rate adjustment and down-payment structure.
export interface FinancingAlternative {
  id: string
  name: string
  downPaymentPct: number
  annualRate: number
  amortYears: number
  downPayment: number
  monthlyPayment: number
  monthlyCashFlow: number
  dscr: number
  cashToClose: number
  eligibilityNote: string
}

export function calculateFinancingAlternatives(params: {
  offerPrice: number
  pmmsRate: number
  monthlyRent: number
  vacancyRate: number
  monthlyExpenses: number
  rehabBudget: number
  propertyType?: string | null
  transferTaxRate?: number
}): FinancingAlternative[] {
  const { offerPrice, pmmsRate, monthlyRent, vacancyRate, monthlyExpenses, rehabBudget, propertyType, transferTaxRate = 0 } = params
  const effectiveRent = monthlyRent * (1 - vacancyRate)
  const ptLower = (propertyType || '').toLowerCase()
  const isSingleUnitCondoLike = /condo|apartment|co-?op|coop/.test(ptLower)
  const isMultiFamily = /multi|duplex|triplex|fourplex|2-4|2_4/.test(ptLower)
  const fhaEligibilityNote = isSingleUnitCondoLike
    ? 'Requires owner-occupancy as primary residence. Building must be on the FHA-approved condo list — verify before writing an offer. MIP premium applies.'
    : isMultiFamily
    ? 'Requires owner-occupancy of one unit. 2-4 unit house-hack allows rental income from other units to offset the mortgage. MIP premium applies.'
    : 'Requires owner-occupancy. House-hack 2-4 unit counts. MIP premium applies.'

  // Each scenario: rate, down, amortization, note.
  const scenarios: Array<Omit<FinancingAlternative, 'downPayment' | 'monthlyPayment' | 'monthlyCashFlow' | 'dscr' | 'cashToClose'>> = [
    {
      id: 'fha',
      name: 'FHA (owner-occupied)',
      downPaymentPct: 0.035,
      annualRate: pmmsRate, // FHA prices near PMMS for owner-occ
      amortYears: 30,
      eligibilityNote: fhaEligibilityNote,
    },
    {
      id: 'conventional',
      name: 'Conventional investor',
      downPaymentPct: 0.25,
      annualRate: pmmsRate + 0.0075, // +75 bps non-owner-occupied
      amortYears: 30,
      eligibilityNote: 'Full income/asset documentation. 25% down typical for 1-unit investment.',
    },
    {
      id: 'dscr',
      name: 'DSCR (no-doc)',
      downPaymentPct: 0.20,
      annualRate: pmmsRate + 0.0100, // +100 bps for DSCR
      amortYears: 30,
      eligibilityNote: 'No personal income verification — qualifies on property DSCR ≥ 1.0-1.25. 20% down.',
    },
  ]

  return scenarios.map((s) => {
    const downPayment = Math.round(offerPrice * s.downPaymentPct)
    const loan = offerPrice - downPayment
    const monthlyPayment = calculateMortgage(loan, s.annualRate, s.amortYears)
    const monthlyCashFlow = Math.round(effectiveRent - monthlyPayment - monthlyExpenses)
    const noiAnnual = (effectiveRent - monthlyExpenses) * 12
    const dscr = calculateDSCR(noiAnnual, monthlyPayment * 12)
    const piti = monthlyPayment + monthlyExpenses
    const cashToClose = downPayment + Math.round(offerPrice * 0.025) + Math.round(offerPrice * transferTaxRate) + 1500 + Math.round(piti * 6) + rehabBudget
    return {
      ...s,
      downPayment,
      monthlyPayment: Math.round(monthlyPayment),
      monthlyCashFlow,
      dscr,
      cashToClose,
    }
  })
}

// --- SHORT-TERM RENTAL PROJECTION ---
// Converts a property's LTR inputs into an STR P&L so investors can see whether
// pivoting to Airbnb/VRBO actually improves the deal after the (much higher) STR
// operating costs. The revenue input is already occupancy-adjusted (comes from
// estimateSTRRevenue in dealDoctor.ts, which bakes in a ~60% occupancy baseline).
export interface STRProjection {
  monthlyGrossRevenue: number
  monthlyOpex: number
  monthlyMortgagePayment: number
  monthlyNetCashFlow: number
  annualNOI: number
  annualDSCR: number
  opExRatio: number
  vsLTRMonthlyDelta: number     // STR CF minus LTR CF; positive = STR wins
  estimatedOccupancy: number    // 0.60 baseline — document the assumption
  breakdown: {
    management: number          // 20% of gross
    cleaning: number            // 10% of gross
    suppliesAndPlatformFees: number // 6% of gross
    utilities: number           // 7% of gross — owner pays (unlike LTR)
    propertyTax: number
    insurance: number           // 50% bump over LTR HO-3 (specialty STR carrier)
    // Hotel Occupancy / lodging tax (state + county + city combined). 0 when
    // the jurisdiction doesn't levy one or we don't have a rule yet. TX+Harris
    // Co = 13%; NYC ≈ 14.75%. Missing this was the biggest remaining STR
    // error in the 4518 Galesburg audit — $364/mo swing on $2,800 gross.
    hotelOccupancyTax: number
    // STR registration fee, amortized to monthly ($23/mo on Houston's
    // $275/yr ordinance). Small but visible when we claim jurisdiction
    // precision.
    strRegistrationFee: number
  }
}

export function calculateSTRProjection(params: {
  monthlyGrossRevenue: number
  monthlyMortgagePayment: number
  monthlyPropertyTax: number
  monthlyInsuranceLTR: number
  monthlyLTRCashFlow: number
  // Optional override for the reported occupancy assumption. Set when a
  // jurisdiction caps non-primary STR nights (e.g. DC 90-night rule) so
  // the displayed occupancy matches the scaled-down revenue figure.
  occupancyOverride?: number
  // Combined state/county/city Hotel Occupancy Tax rate (e.g. 0.13 for TX
  // + Harris County). Scales with gross revenue. Defaults to 0 when the
  // jurisdiction rules don't specify one.
  hotelOccupancyTaxRate?: number
  // Annual STR registration fee (e.g. Houston $275/yr ordinance). Amortized
  // to a monthly P&L line.
  strAnnualRegistrationFee?: number
}): STRProjection {
  const { monthlyGrossRevenue, monthlyMortgagePayment,
          monthlyPropertyTax, monthlyInsuranceLTR, monthlyLTRCashFlow,
          occupancyOverride, hotelOccupancyTaxRate, strAnnualRegistrationFee } = params

  // Variable STR opex as % of gross revenue. Conservative middle-of-the-road
  // assumptions — adjust in the report UI if your market is self-managed or
  // uses a premium PM.
  const management = Math.round(monthlyGrossRevenue * 0.20)
  const cleaning = Math.round(monthlyGrossRevenue * 0.10)
  const suppliesAndPlatformFees = Math.round(monthlyGrossRevenue * 0.06)
  const utilities = Math.round(monthlyGrossRevenue * 0.07)
  const insurance = Math.round(monthlyInsuranceLTR * 1.5)
  const hotelOccupancyTax = Math.round(monthlyGrossRevenue * (hotelOccupancyTaxRate ?? 0))
  const strRegistrationFee = Math.round((strAnnualRegistrationFee ?? 0) / 12)

  const monthlyOpex = management + cleaning + suppliesAndPlatformFees + utilities + monthlyPropertyTax + insurance + hotelOccupancyTax + strRegistrationFee
  const monthlyNetCashFlow = Math.round(monthlyGrossRevenue - monthlyMortgagePayment - monthlyOpex)
  const annualNOI = Math.round((monthlyGrossRevenue - monthlyOpex) * 12)
  const annualDebtService = monthlyMortgagePayment * 12
  const annualDSCR = calculateDSCR(annualNOI, annualDebtService)

  // Variable opex (scales with gross): management + cleaning + supplies +
  // utilities + hotel occupancy tax. Insurance is excluded because it's a
  // fixed $ amount driven by dwelling value, not gross revenue. Base rate
  // (~43%) climbs with jurisdiction HOT (e.g. 56% in Houston, 58% in NYC).
  const variableOpex = management + cleaning + suppliesAndPlatformFees + utilities + hotelOccupancyTax
  const opExRatio = monthlyGrossRevenue > 0
    ? Math.round((variableOpex / monthlyGrossRevenue) * 1000) / 1000
    : 0

  return {
    monthlyGrossRevenue: Math.round(monthlyGrossRevenue),
    monthlyOpex,
    monthlyMortgagePayment: Math.round(monthlyMortgagePayment),
    monthlyNetCashFlow,
    annualNOI,
    annualDSCR,
    opExRatio,
    vsLTRMonthlyDelta: Math.round(monthlyNetCashFlow - monthlyLTRCashFlow),
    estimatedOccupancy: occupancyOverride ?? 0.60,
    breakdown: {
      management,
      cleaning,
      suppliesAndPlatformFees,
      utilities,
      propertyTax: monthlyPropertyTax,
      insurance,
      hotelOccupancyTax,
      strRegistrationFee,
    },
  }
}

// --- SENSITIVITY ANALYSIS ---
// Re-runs the core metrics under adverse/favorable scenarios so investors can
// see "how safe is this deal?" at a glance. Investors paying $24.99 for a report
// routinely test: what if rent drops 10%? what if the refi rate is +100bps?
export interface SensitivityRow {
  scenario: string
  description: string
  monthlyCashFlow: number
  cashFlowDelta: number       // vs base
  dscr: number
  fiveYrWealth: number
  wealthDelta: number         // vs base
  fiveYrIRR: number
}

export interface SensitivityInputs {
  offerPrice: number
  downPaymentPct: number
  annualRate: number
  monthlyRent: number
  vacancyRate: number
  monthlyExpenses: number
  rehabBudget: number
  annualDepreciation: number
  cashToClose: number
  // Base-case growth rates used by the hero 5yr IRR projection. When
  // provided, the "Base case" sensitivity row uses these EXACTLY so the
  // hero and the sensitivity table can't disagree on the base-case IRR.
  // Previously the sensitivity hardcoded 3% appreciation and implicitly 0
  // rent / expense growth — producing e.g. a +6.8% Base-case IRR while
  // the hero (using zip data at -1% appreciation) showed -13.8% (DC
  // Apolline audit). All the OTHER scenarios still offset from these.
  baseAppreciationRate?: number
  baseRentGrowthRate?: number
  baseExpenseGrowthRate?: number
}

function runSingleScenario(
  inputs: SensitivityInputs,
  mods: { rentMult: number; rateDelta: number; expenseMult: number; appreciation: number }
): { monthlyCashFlow: number; dscr: number; fiveYrWealth: number; fiveYrIRR: number } {
  const price = inputs.offerPrice
  const loan = price * (1 - inputs.downPaymentPct)
  const rate = inputs.annualRate + mods.rateDelta
  const rent = inputs.monthlyRent * mods.rentMult
  const expenses = inputs.monthlyExpenses * mods.expenseMult

  const payment = calculateMortgage(loan, rate, 30)
  const effectiveRent = rent * (1 - inputs.vacancyRate)
  const monthlyCashFlow = Math.round(effectiveRent - payment - expenses)
  const noi = (effectiveRent - expenses) * 12
  const dscr = calculateDSCR(noi, payment * 12)

  const projections = projectWealth({
    offerPrice: price,
    loanAmount: loan,
    annualRate: rate,
    amortYears: 30,
    initialMonthlyRent: rent,
    vacancyRate: inputs.vacancyRate,
    initialMonthlyExpenses: expenses,
    annualDepreciation: inputs.annualDepreciation,
    appreciationRate: mods.appreciation,
    // Propagate the hero's actual rent / expense growth rates when
    // available. Without these, the sensitivity's implicit 0% rent growth
    // made the Base-case IRR differ from the hero (which uses zip data).
    rentGrowthRate: inputs.baseRentGrowthRate,
    expenseGrowthRate: inputs.baseExpenseGrowthRate,
    years: 5,
  })
  const fiveYrWealth = projections[projections.length - 1]?.totalWealthBuilt ?? 0
  const fiveYrIRR = calculateHoldPeriodIRR(inputs.cashToClose, projections)

  return { monthlyCashFlow, dscr, fiveYrWealth, fiveYrIRR }
}

export function calculateSensitivity(inputs: SensitivityInputs): SensitivityRow[] {
  // Use the hero's actual base-case appreciation (zip-derived) when the
  // caller provides it — otherwise fall back to the legacy 3% default.
  // Sensitivity row values are ABSOLUTE (not deltas), so this change
  // only affects the Base-case and scenarios that share its appreciation.
  const baseAppr = inputs.baseAppreciationRate ?? 0.03
  const baseApprPct = (baseAppr * 100).toFixed(1)

  const base = runSingleScenario(inputs, {
    rentMult: 1, rateDelta: 0, expenseMult: 1, appreciation: baseAppr,
  })

  const scenarios: Array<{
    scenario: string
    description: string
    mods: { rentMult: number; rateDelta: number; expenseMult: number; appreciation: number }
  }> = [
    { scenario: 'Base case', description: `Inputs as reported, ${baseApprPct}% appreciation`, mods: { rentMult: 1, rateDelta: 0, expenseMult: 1, appreciation: baseAppr } },
    { scenario: 'Rent −10%', description: 'Softer rental market', mods: { rentMult: 0.9, rateDelta: 0, expenseMult: 1, appreciation: baseAppr } },
    { scenario: 'Rent +10%', description: 'Rent outperforms', mods: { rentMult: 1.1, rateDelta: 0, expenseMult: 1, appreciation: baseAppr } },
    { scenario: 'Rate +1%', description: 'Rate spike at refi', mods: { rentMult: 1, rateDelta: 0.01, expenseMult: 1, appreciation: baseAppr } },
    { scenario: 'Expenses +20%', description: 'Inflation / vacancy spike', mods: { rentMult: 1, rateDelta: 0, expenseMult: 1.2, appreciation: baseAppr } },
    { scenario: 'Appreciation 0%', description: 'Flat market', mods: { rentMult: 1, rateDelta: 0, expenseMult: 1, appreciation: 0 } },
    { scenario: 'Appreciation 5%', description: 'Hot market', mods: { rentMult: 1, rateDelta: 0, expenseMult: 1, appreciation: 0.05 } },
  ]

  return scenarios.map((s) => {
    const r = runSingleScenario(inputs, s.mods)
    return {
      scenario: s.scenario,
      description: s.description,
      monthlyCashFlow: r.monthlyCashFlow,
      cashFlowDelta: r.monthlyCashFlow - base.monthlyCashFlow,
      dscr: r.dscr,
      fiveYrWealth: r.fiveYrWealth,
      wealthDelta: r.fiveYrWealth - base.fiveYrWealth,
      fiveYrIRR: r.fiveYrIRR,
    }
  })
}

// --- RECOMMENDED MAX OFFER (solve for price given a target metric) ---
// Takes the deal's rent/rate/expenses as fixed and finds the max purchase price
// that still clears a target metric. Turns the single breakeven number into
// three actionable targets: "safe", "good", "great" offers.
export interface RecommendedOffers {
  breakevenPrice: number                               // CF ≥ 0
  priceForCashOnCash: { target: number; maxPrice: number } // CoC ≥ target
  priceForIRR: { target: number; maxPrice: number }        // 5yr IRR ≥ target
}

export function calculateRecommendedOffers(params: {
  monthlyRent: number
  vacancyRate: number
  annualRate: number
  downPaymentPct: number
  rehabBudget: number
  propertyTaxRate: number       // fraction of price, e.g. 0.018
  monthlyInsurance: number      // absolute $
  monthlyMaintenance: number
  monthlyHOA: number
  targetCoC?: number            // default 0.08
  targetIRR?: number            // default 0.10
  offerPrice?: number           // subject price — sets bisection ceiling so $3M+ luxury subjects aren't clamped
}): RecommendedOffers {
  const {
    monthlyRent, vacancyRate, annualRate, downPaymentPct, rehabBudget,
    propertyTaxRate, monthlyInsurance, monthlyMaintenance, monthlyHOA,
    targetCoC = 0.08, targetIRR = 0.10, offerPrice,
  } = params

  const expensesAt = (price: number): number =>
    Math.round((price * propertyTaxRate) / 12) + monthlyInsurance + monthlyMaintenance + monthlyHOA

  const cocAt = (price: number): number => {
    const loan = price * (1 - downPaymentPct)
    const payment = calculateMortgage(loan, annualRate, 30)
    const effRent = monthlyRent * (1 - vacancyRate)
    const expenses = expensesAt(price)
    const monthlyCF = effRent - payment - expenses
    // Match irrAt denominator: downPayment + 2.5% closing + $1500 inspection
    // + 6mo PITI reserves + rehab. Prior version only used downPayment + rehab,
    // inflating CoC and letting marginal deals clear the 8% DEAL threshold.
    const piti = payment + expenses
    const cashIn = price * downPaymentPct + price * 0.025 + 1500 + piti * 6 + rehabBudget
    return cashIn > 0 ? (monthlyCF * 12) / cashIn : 0
  }

  const irrAt = (price: number): number => {
    const loan = price * (1 - downPaymentPct)
    const expenses = expensesAt(price)
    const annualDep = Math.round((price * 0.80) / 27.5)
    const projections = projectWealth({
      offerPrice: price, loanAmount: loan, annualRate, amortYears: 30,
      initialMonthlyRent: monthlyRent, vacancyRate,
      initialMonthlyExpenses: expenses, annualDepreciation: annualDep,
      years: 5,
    })
    // Simplified cash-to-close for the IRR denominator (2.5% closing, 6mo PITI)
    const payment = calculateMortgage(loan, annualRate, 30)
    const piti = payment + (price * propertyTaxRate) / 12 + monthlyInsurance
    const cashIn = price * downPaymentPct + price * 0.025 + 1500 + piti * 6 + rehabBudget
    return calculateHoldPeriodIRR(cashIn, projections)
  }

  // Binary search for max price where metricAt(price) >= target.
  // Metrics are monotonically decreasing in price → crossover exists.
  const bisectMaxPrice = (evaluate: (p: number) => number, target: number): number => {
    let low = 30_000
    // Dynamic ceiling: keep 2× the subject price as headroom so luxury
    // subjects ($5M+) can reach their valid offer range. Flat $10M clamped
    // anything above that.
    let high = Math.max(10_000_000, (offerPrice ?? 0) * 2)
    // If even the lowest price doesn't hit the target, return low (no valid offer)
    if (evaluate(low) < target) return 0
    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2
      if (evaluate(mid) >= target) low = mid
      else high = mid
    }
    return Math.round(((low + high) / 2) / 1000) * 1000
  }

  return {
    // Pass the deal's ACTUAL expense stack to the breakeven solver. Without
    // this, recommendedOffers.breakevenPrice used default assumptions (1%
    // tax, $125 ins, $150 maint, $0 HOA) while the hero breakeven used the
    // real inputs — producing two different breakeven numbers in the same
    // report. Now both agree.
    breakevenPrice: calculateBreakEvenPrice(monthlyRent, annualRate, {
      downPaymentPct,
      propertyTaxRate,
      monthlyInsurance,
      monthlyHOA,
      monthlyMaintenance,
      offerPrice,
    }),
    priceForCashOnCash: {
      target: targetCoC,
      maxPrice: bisectMaxPrice(cocAt, targetCoC),
    },
    priceForIRR: {
      target: targetIRR,
      maxPrice: bisectMaxPrice(irrAt, targetIRR),
    },
  }
}

// --- STATE PROPERTY TAX GROWTH RATES ---
// Annual rate at which property tax can realistically grow, reflecting each
// state's reassessment regime. Matters for 5-year wealth projection because
// CA (Prop 13, 2% cap) and TX (no cap on investment properties, hot market)
// produce very different expense trajectories from a generic 3% default.
//
// Values are intentionally conservative — tuned to historical averages, not
// worst-case market spikes. Where a cap exists, we use the cap's effective
// realistic rate, not the cap ceiling itself.
const STATE_TAX_GROWTH: Record<string, number> = {
  CA: 0.02,  // Prop 13: 2% cap on assessment increases
  AZ: 0.02,  // Prop 117: 5% LPV cap, ~2% real growth
  OR: 0.03,  // Measure 50: 3% cap on LPV
  MI: 0.02,  // Headlee + Prop A: min(CPI, 5%)
  MA: 0.025, // Prop 2½ cap
  FL: 0.06,  // Non-homestead 10% cap; realistic reassessment ~6%/yr
  TX: 0.06,  // No cap on investor properties; hot-market reassessments
  GA: 0.04,
  CO: 0.04,  // Gallagher amendment repealed; assessments catching up
  ID: 0.04,
  NC: 0.03,
  SC: 0.03,
  TN: 0.03,
  NV: 0.03,
  UT: 0.03,
  NM: 0.03,
  WA: 0.04,
  NY: 0.03,  // Varies by county; NYC has caps, upstate doesn't
  NJ: 0.04,  // No cap, high taxes already
  IL: 0.04,  // Full reassessment, high taxes
  OH: 0.03,
  IN: 0.03,
  PA: 0.03,
  WI: 0.03,
  MN: 0.03,
  MD: 0.03,
  VA: 0.03,
  DE: 0.03,
  KY: 0.03,
  AL: 0.03,
  MS: 0.03,
  LA: 0.03,
  AR: 0.03,
  OK: 0.03,
  KS: 0.03,
  MO: 0.03,
  IA: 0.03,
  NE: 0.03,
  SD: 0.03,
  ND: 0.03,
  MT: 0.03,
  WY: 0.02,
  HI: 0.03,
  AK: 0.03,
  ME: 0.03,
  NH: 0.03,
  VT: 0.03,
  RI: 0.03,
  CT: 0.03,
  WV: 0.03,
  DC: 0.03,
}
export function getStatePropertyTaxGrowth(state: string): number {
  return STATE_TAX_GROWTH[state] ?? 0.03
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
  // FL: 0.9% is the homesteaded (Save Our Homes) rate — investors get NO SOH cap,
  // so non-homesteaded effective rates run 1.1–1.8% depending on county. Use 1.1%
  // as the non-homesteaded statewide fallback; high-tax counties (Broward, Miami-Dade)
  // are overridden per-city in CITY_RULES. All FL STR revenue is subject to FL 6%
  // sales tax + county Tourist Development Tax (TDT, typically 5–6%).
  FL: { name: 'Florida', propertyTaxRate: 0.011, rentControl: false, landlordFriendly: true, strNotes: 'Investment properties are NOT eligible for Florida\'s Save Our Homes 3% assessment cap (homesteaded primary residences only) — effective non-homesteaded rates vary from ~1.1% (rural) to ~1.7% (Miami-Dade/Broward). All STR revenue is subject to FL 6% sales tax + county Tourist Development Tax (TDT, 5–6% depending on county). SB 714 (2024) limits some local STR bans but does not fully preempt county/city rules. Major markets require STR registration.' },
  // CA: 0.73% reflects the statewide portfolio average suppressed by Prop 13 lock-in
  // across long-held properties. For a NEW purchase the effective rate is ~1.1%.
  // AB 1482 (Tenant Protection Act): SFRs are NOT automatically exempt when held in
  // an LLC — exemption requires (1) natural-person owner, (2) written tenant notice
  // per Civil Code §1946.2(e), (3) no corporate ownership. Most investors hold through
  // LLCs and are therefore SUBJECT to the 5%+CPI / max 10% annual rent cap.
  CA: { name: 'California', propertyTaxRate: 0.0073, rentControl: true, landlordFriendly: false, strNotes: 'Many cities restrict STR. LA, SF, and Sacramento require permits. Prop 13 locks assessed value at purchase — effective rate ~1.1% at acquisition. AB 1482 rent control applies to most rentals including LLC-held SFRs (5% + CPI annual cap, max 10%/yr). SFR exemption from AB 1482 requires owner to be a natural person (not LLC/corporation) AND provide written tenant notice per Civil Code §1946.2(e) — verify with counsel before assuming exemption.' },
  NY: { name: 'New York', propertyTaxRate: 0.017, rentControl: true, landlordFriendly: false, strNotes: 'NYC (all five boroughs) effectively bans most short-term rentals under 30 days under Local Law 18. Rules vary elsewhere in the state — Long Island, Hudson Valley, and upstate have municipality-by-municipality STR regulations. NYC also has strict rent stabilization. Check local rules for non-NYC addresses.' },
  OH: { name: 'Ohio', propertyTaxRate: 0.016, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  GA: { name: 'Georgia', propertyTaxRate: 0.009, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions. Atlanta requires permits.' },
  NC: { name: 'North Carolina', propertyTaxRate: 0.008, rentControl: false, landlordFriendly: true, strNotes: 'Generally STR-friendly. Check HOA rules.' },
  TN: { name: 'Tennessee', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'Nashville requires permits for non-owner-occupied STR.' },
  AZ: { name: 'Arizona', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'State law preempts local STR bans. Very STR-friendly.' },
  CO: { name: 'Colorado', propertyTaxRate: 0.005, rentControl: false, landlordFriendly: true, strNotes: 'Denver requires STR license. Mountain towns may restrict.' },
  // IN: state-average 0.8% is statewide blended including homesteads. Marion County
  // (Indianapolis) non-homesteaded investment SFR runs ~2.0–2.2% (subject to Indiana's
  // 2% circuit breaker cap for rental property). City-level override covers Marion County.
  IN: { name: 'Indiana', propertyTaxRate: 0.008, rentControl: false, landlordFriendly: true, strNotes: 'Indiana levies a 7% state innkeeper\'s tax on all STR revenue; counties add their own rate (Marion County adds 6%, totaling ~13% in Indianapolis). Indiana\'s SFR investment property is subject to a 2% circuit breaker cap on property tax as a % of gross assessed value — Marion County\'s effective non-homesteaded rate is ~2.1%, far above the 0.8% statewide average. No statewide STR permitting, but check municipal rules.' },
  MI: { name: 'Michigan', propertyTaxRate: 0.015, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR ban. Some lakeside communities restrict.' },
  PA: { name: 'Pennsylvania', propertyTaxRate: 0.015, rentControl: false, landlordFriendly: true, strNotes: 'Philadelphia requires STR license.' },
  IL: { name: 'Illinois', propertyTaxRate: 0.021, rentControl: false, landlordFriendly: false, strNotes: 'Chicago RLTO governs landlord/tenant (strong tenant protections, security-deposit interest, written lease disclosures) but Chicago has NOT enacted rent control; IL repealed its statewide preemption in 2021. Chicago requires STR license with unit cap.' },
  WA: { name: 'Washington', propertyTaxRate: 0.009, rentControl: true, landlordFriendly: false, strNotes: 'Seattle restricts STR to primary residences.' },
  NV: { name: 'Nevada', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'Las Vegas requires STR business license.' },
  MO: { name: 'Missouri', propertyTaxRate: 0.010, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  SC: { name: 'South Carolina', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'Generally STR-friendly. Beach communities may have rules.' },
  // --- Remaining states (effective rates per Tax Foundation / ATTOM). Default to
  // landlordFriendly: true + no rent control unless a statewide regime exists. Per-city
  // STR rules vary; strNotes points to municipal verification.
  AL: { name: 'Alabama', propertyTaxRate: 0.004, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions. Check municipal rules.' },
  AK: { name: 'Alaska', propertyTaxRate: 0.012, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions. Anchorage requires registration.' },
  AR: { name: 'Arkansas', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions. Check municipal rules.' },
  CT: { name: 'Connecticut', propertyTaxRate: 0.020, rentControl: false, landlordFriendly: false, strNotes: 'No statewide STR ban. Tenant-friendly eviction rules.' },
  DC: { name: 'District of Columbia', propertyTaxRate: 0.0085, rentControl: true, landlordFriendly: false, strNotes: 'DC caps STR at 90 non-primary-residence nights/yr and requires a license.' },
  DE: { name: 'Delaware', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions. Beach towns regulate.' },
  HI: { name: 'Hawaii', propertyTaxRate: 0.003, rentControl: false, landlordFriendly: true, strNotes: 'Honolulu 30-day minimum outside resort zones; statewide STR scrutiny is intense.' },
  IA: { name: 'Iowa', propertyTaxRate: 0.014, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  ID: { name: 'Idaho', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'State preempts local STR bans; very STR-friendly.' },
  KS: { name: 'Kansas', propertyTaxRate: 0.013, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  KY: { name: 'Kentucky', propertyTaxRate: 0.008, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions. Louisville / Lexington regulate.' },
  LA: { name: 'Louisiana', propertyTaxRate: 0.005, rentControl: false, landlordFriendly: true, strNotes: 'New Orleans bans STR in most residential zones.' },
  MA: { name: 'Massachusetts', propertyTaxRate: 0.012, rentControl: false, landlordFriendly: false, strNotes: 'No statewide STR ban; Boston requires registration and primary-residence rule.' },
  MD: { name: 'Maryland', propertyTaxRate: 0.010, rentControl: false, landlordFriendly: false, strNotes: 'No statewide STR restrictions. Counties regulate.' },
  ME: { name: 'Maine', propertyTaxRate: 0.012, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions. Coastal towns may restrict.' },
  MN: { name: 'Minnesota', propertyTaxRate: 0.011, rentControl: true, landlordFriendly: false, strNotes: 'No statewide STR ban. Minneapolis / St Paul regulate.' },
  MS: { name: 'Mississippi', propertyTaxRate: 0.007, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  MT: { name: 'Montana', propertyTaxRate: 0.008, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions. Resort towns regulate.' },
  ND: { name: 'North Dakota', propertyTaxRate: 0.010, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  NE: { name: 'Nebraska', propertyTaxRate: 0.016, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  NH: { name: 'New Hampshire', propertyTaxRate: 0.021, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  NJ: { name: 'New Jersey', propertyTaxRate: 0.022, rentControl: true, landlordFriendly: false, strNotes: 'Many shore towns restrict STR. Strong tenant protections.' },
  NM: { name: 'New Mexico', propertyTaxRate: 0.007, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR ban. Santa Fe caps STR units city-wide.' },
  OK: { name: 'Oklahoma', propertyTaxRate: 0.009, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  OR: { name: 'Oregon', propertyTaxRate: 0.009, rentControl: true, landlordFriendly: false, strNotes: 'Statewide rent control (SB 608). Portland restricts STR.' },
  RI: { name: 'Rhode Island', propertyTaxRate: 0.014, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions. Newport regulates.' },
  SD: { name: 'South Dakota', propertyTaxRate: 0.012, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  UT: { name: 'Utah', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'Salt Lake / Park City require STR permits.' },
  VA: { name: 'Virginia', propertyTaxRate: 0.008, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR ban. Fairfax / Arlington regulate.' },
  VT: { name: 'Vermont', propertyTaxRate: 0.018, rentControl: false, landlordFriendly: false, strNotes: 'Statewide STR registration required; towns may restrict further.' },
  WI: { name: 'Wisconsin', propertyTaxRate: 0.016, rentControl: false, landlordFriendly: true, strNotes: 'State preempts most local STR bans; 6-or-more nights permitted.' },
  WV: { name: 'West Virginia', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
  WY: { name: 'Wyoming', propertyTaxRate: 0.006, rentControl: false, landlordFriendly: true, strNotes: 'No statewide STR restrictions.' },
}

// --- CITY RULE OVERRIDES ---
// Some jurisdictions diverge sharply from statewide defaults — Baltimore City's
// effective real property tax is ~2.248% vs Maryland's ~1.0% state average, and
// Baltimore City §5A restricts whole-unit non-owner-occupied STR. Keyed by
// "CITY, ST" (upper-cased, trimmed). Overrides merge field-by-field over the
// resolved STATE_RULES entry.
export const CITY_RULES: Record<string, Partial<{
  propertyTaxRate: number
  rentControl: boolean
  landlordFriendly: boolean
  strNotes: string
  // Combined state/county/city Hotel Occupancy Tax rate for STR. Not every
  // city has an override — when absent, the state default (0) applies and
  // the STR opex stack simply doesn't deduct HOT.
  hotelOccupancyTaxRate: number
  // Annual STR registration / permit fee (Houston $275/yr as of Jan 2026).
  // Small, but visible in the STR opex breakdown when jurisdiction has one.
  strAnnualRegistrationFee: number
  // Buyer-side transfer / recordation tax, combined state + county + city,
  // expressed as a fraction of offer price. Used to inflate the flat 2.5%
  // closing-cost estimate in cities with material transaction taxes (NYC
  // ~1.825%, DC 1.45%, Philly 2.14%, Chicago 0.75%, Baltimore 1.5%).
  // Default 0 — most markets fold it into the 2.5% lump.
  transferTaxRate: number
}>> = {
  'BALTIMORE, MD': {
    propertyTaxRate: 0.02248,
    // Buyer-side: MD state 0.5% + Baltimore City 1.0% ≈ 1.5% of price.
    transferTaxRate: 0.015,
    strNotes: 'Baltimore City Code §5A restricts STR hosts to their primary residence; whole-unit non-owner-occupied STR is broadly prohibited. Investor STR generally not permitted absent the primary-residence / 90-day carve-out.',
  },
  // Harris County effective rate is ~2.03% (City of Houston $0.52 + Harris
  // County $0.39 + HISD $0.87 per $100, roughly). TX state-average of 1.80%
  // understated monthly tax by ~$25 on a $128K property in the 4518
  // Galesburg St audit.
  //
  // Houston STR ordinance took effect Jan 1, 2026 — legal but now regulated:
  // $275 annual registration, safety inspection, human trafficking awareness
  // training, 13% combined HOT tax (6% TX + 7% Harris County), and event-
  // venue advertising prohibited. Prior note ("no statewide restrictions")
  // missed the municipal layer.
  'HOUSTON, TX': {
    propertyTaxRate: 0.0203,
    hotelOccupancyTaxRate: 0.13,
    strAnnualRegistrationFee: 275,
    strNotes: 'Houston STR ordinance effective Jan 1, 2026: $275 annual registration, safety inspection, and human trafficking awareness training required. 13% combined hotel occupancy tax applies (6% TX + 7% Harris County). Event-venue advertising prohibited. STR is legal but factor the $275 registration + 13% HOT tax into net revenue.',
  },
  // NYC: NY state RPTT 0.4% + NYC RPTT 1.425% (residential > $500K) ≈ 1.825%.
  // Does NOT include the progressive mansion tax (additional 1%+ on $1M+);
  // that layer is a separate bracket we'd model if/when we add $1M+ deals.
  'NEW YORK, NY': { transferTaxRate: 0.01825 },
  'MANHATTAN, NY': { transferTaxRate: 0.01825 },
  'BROOKLYN, NY': { transferTaxRate: 0.01825 },
  'QUEENS, NY': { transferTaxRate: 0.01825 },
  'BRONX, NY': { transferTaxRate: 0.01825 },
  'STATEN ISLAND, NY': { transferTaxRate: 0.01825 },
  // DC: buyer pays recordation tax 1.45% on price (transfer tax is seller-side).
  'WASHINGTON, DC': { transferTaxRate: 0.0145 },
  // Philadelphia: combined 4.278% (1% state + 3.278% city), customarily split
  // buyer/seller — buyer eats ~2.14%. Still one of the highest in the country.
  'PHILADELPHIA, PA': { transferTaxRate: 0.02139 },
  // Cook County + Chicago transfer stamps: 0.5% buyer-facing combined state +
  // county stamps, plus Chicago's 0.25% buyer Real Property Transfer Tax.
  'CHICAGO, IL': { transferTaxRate: 0.0075 },

  // ── Florida: county-level property tax + STR lodging tax overrides ───────────
  //
  // FL homesteaded effective rate ~0.9% (Save Our Homes cap); non-homesteaded
  // investment properties have no cap — county-level rates below reflect
  // non-homesteaded combined millage. STR lodging tax = FL 6% sales tax +
  // county Tourist Development Tax (TDT) per FSS §125.0104.
  //
  // Broward County (Fort Lauderdale metro): ~1.65% non-homesteaded, 12% STR HOT
  'FORT LAUDERDALE, FL': {
    propertyTaxRate: 0.0165,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Fort Lauderdale requires vacation rental registration with DBPR and the city. FL 6% sales tax + 6% Broward County TDT = 12% on all STR gross revenue. Non-homesteaded investment properties: effective Broward County rate ~1.65% (no Save Our Homes cap).',
  },
  'HOLLYWOOD, FL': {
    propertyTaxRate: 0.0165,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Hollywood (Broward County) requires vacation rental registration. FL 6% sales tax + 6% Broward TDT = 12% on STR gross. Non-homesteaded effective rate ~1.65%.',
  },
  'POMPANO BEACH, FL': {
    propertyTaxRate: 0.0165,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Pompano Beach (Broward County). FL 6% sales tax + 6% Broward TDT = 12% on STR gross. Non-homesteaded effective rate ~1.65%.',
  },
  'DEERFIELD BEACH, FL': {
    propertyTaxRate: 0.0165,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Deerfield Beach (Broward County). FL 6% sales tax + 6% Broward TDT = 12% on STR gross. Non-homesteaded effective rate ~1.65%.',
  },
  'MIRAMAR, FL': {
    propertyTaxRate: 0.0165,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Miramar (Broward County). FL 6% sales tax + 6% Broward TDT = 12% on STR gross. Non-homesteaded effective rate ~1.65%.',
  },
  'PEMBROKE PINES, FL': {
    propertyTaxRate: 0.0165,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Pembroke Pines (Broward County). FL 6% sales tax + 6% Broward TDT = 12% on STR gross. Non-homesteaded effective rate ~1.65%.',
  },
  'CORAL SPRINGS, FL': {
    propertyTaxRate: 0.0165,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Coral Springs (Broward County). FL 6% sales tax + 6% Broward TDT = 12% on STR gross. Non-homesteaded effective rate ~1.65%.',
  },
  'PLANTATION, FL': {
    propertyTaxRate: 0.0165,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Plantation (Broward County). FL 6% sales tax + 6% Broward TDT = 12% on STR gross. Non-homesteaded effective rate ~1.65%.',
  },
  'SUNRISE, FL': {
    propertyTaxRate: 0.0165,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Sunrise (Broward County). FL 6% sales tax + 6% Broward TDT = 12% on STR gross. Non-homesteaded effective rate ~1.65%.',
  },
  'DAVIE, FL': {
    propertyTaxRate: 0.0165,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Davie (Broward County). FL 6% sales tax + 6% Broward TDT = 12% on STR gross. Non-homesteaded effective rate ~1.65%.',
  },
  'HALLANDALE BEACH, FL': {
    propertyTaxRate: 0.0165,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Hallandale Beach (Broward County). FL 6% sales tax + 6% Broward TDT = 12% on STR gross. Non-homesteaded effective rate ~1.65%.',
  },
  // Miami-Dade County: ~1.70% non-homesteaded, ~13% STR HOT
  // (6% FL + 2% discretionary surtax + 3% TDT + 2% convention dev tax — exact
  // blended rate varies by precise location within the county; 13% is the typical
  // investor-facing combined rate for Miami-area short-term rentals.)
  'MIAMI, FL': {
    propertyTaxRate: 0.0170,
    hotelOccupancyTaxRate: 0.13,
    strNotes: 'Miami requires STR registration. FL sales tax + Miami-Dade TDT/convention levies = ~13% on STR gross. Non-homesteaded effective rate ~1.7%. Miami Beach operates additional strict STR enforcement (separate permit required).',
  },
  'MIAMI BEACH, FL': {
    propertyTaxRate: 0.0170,
    hotelOccupancyTaxRate: 0.13,
    strNotes: 'Miami Beach has aggressive STR enforcement — city permit required, frequent inspections, significant fines for violations. FL + Miami-Dade combined lodging tax ~13% on STR gross. Non-homesteaded rate ~1.7%.',
  },
  'HIALEAH, FL': {
    propertyTaxRate: 0.0170,
    hotelOccupancyTaxRate: 0.13,
    strNotes: 'Hialeah (Miami-Dade County). FL + Miami-Dade combined lodging tax ~13% on STR gross. Non-homesteaded effective rate ~1.7%.',
  },
  'CORAL GABLES, FL': {
    propertyTaxRate: 0.0170,
    hotelOccupancyTaxRate: 0.13,
    strNotes: 'Coral Gables (Miami-Dade County) has strict residential STR ordinance — permit required, primary-residence restrictions in many zones. FL + Miami-Dade combined lodging tax ~13% on STR gross. Non-homesteaded rate ~1.7%.',
  },
  'MIAMI GARDENS, FL': {
    propertyTaxRate: 0.0170,
    hotelOccupancyTaxRate: 0.13,
    strNotes: 'Miami Gardens (Miami-Dade County). FL + Miami-Dade combined lodging tax ~13% on STR gross. Non-homesteaded effective rate ~1.7%.',
  },
  // Palm Beach County: ~1.55% non-homesteaded, 12% STR HOT (6% FL + 6% PB TDT)
  'WEST PALM BEACH, FL': {
    propertyTaxRate: 0.0155,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'West Palm Beach (Palm Beach County). FL 6% sales tax + 6% Palm Beach TDT = 12% on STR gross. Non-homesteaded effective rate ~1.55%. City requires STR registration.',
  },
  'BOCA RATON, FL': {
    propertyTaxRate: 0.0155,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Boca Raton (Palm Beach County). FL 6% sales tax + 6% Palm Beach TDT = 12% on STR gross. Non-homesteaded effective rate ~1.55%.',
  },
  'DELRAY BEACH, FL': {
    propertyTaxRate: 0.0155,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Delray Beach (Palm Beach County). FL 6% sales tax + 6% Palm Beach TDT = 12% on STR gross. Non-homesteaded effective rate ~1.55%.',
  },
  'BOYNTON BEACH, FL': {
    propertyTaxRate: 0.0155,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Boynton Beach (Palm Beach County). FL 6% sales tax + 6% Palm Beach TDT = 12% on STR gross. Non-homesteaded effective rate ~1.55%.',
  },
  'LAKE WORTH, FL': {
    propertyTaxRate: 0.0155,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Lake Worth Beach (Palm Beach County). FL 6% sales tax + 6% Palm Beach TDT = 12% on STR gross. Non-homesteaded effective rate ~1.55%.',
  },
  // Hillsborough County / Tampa: ~1.40% non-homesteaded, 13% STR HOT
  // (6% FL + 7% Hillsborough TDT)
  'TAMPA, FL': {
    propertyTaxRate: 0.0140,
    hotelOccupancyTaxRate: 0.13,
    strNotes: 'Tampa (Hillsborough County) requires STR registration. FL 6% sales tax + 7% Hillsborough TDT = 13% on STR gross. Non-homesteaded effective rate ~1.4%.',
  },
  'BRANDON, FL': {
    propertyTaxRate: 0.0140,
    hotelOccupancyTaxRate: 0.13,
    strNotes: 'Brandon (Hillsborough County). FL 6% sales tax + 7% Hillsborough TDT = 13% on STR gross. Non-homesteaded effective rate ~1.4%.',
  },
  // Pinellas County / St. Pete: ~1.45% non-homesteaded, 13% STR HOT
  // (6% FL + 7% Pinellas TDT)
  'ST. PETERSBURG, FL': {
    propertyTaxRate: 0.0145,
    hotelOccupancyTaxRate: 0.13,
    strNotes: 'St. Petersburg (Pinellas County). FL 6% sales tax + 7% Pinellas TDT = 13% on STR gross. Non-homesteaded effective rate ~1.45%.',
  },
  'CLEARWATER, FL': {
    propertyTaxRate: 0.0145,
    hotelOccupancyTaxRate: 0.13,
    strNotes: 'Clearwater (Pinellas County). FL 6% sales tax + 7% Pinellas TDT = 13% on STR gross. Non-homesteaded effective rate ~1.45%.',
  },
  // Orange County / Orlando: ~1.35% non-homesteaded, 12.5% STR HOT
  // (6% FL + 6.5% Orange County TDT)
  'ORLANDO, FL': {
    propertyTaxRate: 0.0135,
    hotelOccupancyTaxRate: 0.125,
    strNotes: 'Orlando (Orange County) requires vacation rental registration. FL 6% sales tax + 6.5% Orange County TDT = 12.5% on STR gross. Non-homesteaded effective rate ~1.35%.',
  },
  'KISSIMMEE, FL': {
    propertyTaxRate: 0.0135,
    hotelOccupancyTaxRate: 0.125,
    strNotes: 'Kissimmee (Osceola County, adjacent to Orange; similar STR regime). FL 6% sales tax + ~6% TDT ≈ 12% on STR gross. Non-homesteaded rate ~1.35%. Heavy STR market — verify current permitting.',
  },
  // Duval County / Jacksonville: ~1.20% non-homesteaded, 12% STR HOT
  // (6% FL + 6% Duval TDT)
  'JACKSONVILLE, FL': {
    propertyTaxRate: 0.0120,
    hotelOccupancyTaxRate: 0.12,
    strNotes: 'Jacksonville (Duval County). FL 6% sales tax + 6% Duval TDT = 12% on STR gross. Non-homesteaded effective rate ~1.2%.',
  },

  // ── Indiana: Marion County (Indianapolis) ────────────────────────────────────
  //
  // Indiana's SFR investment property is subject to a 2% circuit breaker cap on
  // property tax as a % of gross assessed value. Marion County's effective non-
  // homesteaded rate for investment SFR is ~2.0–2.2% — roughly 2.5× the 0.8%
  // statewide average. Combined innkeeper's tax: 7% IN state + 6% Marion County = 13%.
  'INDIANAPOLIS, IN': {
    propertyTaxRate: 0.021,
    hotelOccupancyTaxRate: 0.13,
    strNotes: 'Indianapolis (Marion County). Indiana levies 7% state innkeeper\'s tax + 6% Marion County innkeeper\'s tax = 13% on all STR gross revenue. Marion County non-homesteaded investment SFR: effective rate ~2.0–2.2% (Indiana\'s 2% circuit breaker caps rental-property tax at 2% of gross assessed value). No statewide STR permit requirement; verify county zoning.',
  },

  // ── California: Sacramento County ────────────────────────────────────────────
  //
  // Prop 13 locks assessed value at purchase price — effective rate at acquisition
  // is ~1.1% (base 1% + city/district levies). Sacramento city TOT: 12% on STR
  // gross. STR permits: $267/yr hosted (owner present), ~$600/yr un-hosted.
  'SACRAMENTO, CA': {
    propertyTaxRate: 0.011,
    hotelOccupancyTaxRate: 0.12,
    strAnnualRegistrationFee: 600,
    strNotes: 'Sacramento requires STR permits: $267/yr (hosted, owner-present) or ~$600/yr (un-hosted). 12% Transient Occupancy Tax (TOT) applies to all STR gross revenue. Prop 13: assessed at purchase price, effective rate ~1.1% at acquisition. AB 1482 rent control applies to most rentals including LLC-held SFRs (5% + CPI annual cap, max 10%) — SFR exemption requires natural-person owner and written tenant notice per Civil Code §1946.2(e).',
  },
}

export function getJurisdictionRules(
  state: string,
  city?: string | null
): {
  name: string
  propertyTaxRate: number
  rentControl: boolean
  landlordFriendly: boolean
  strNotes: string
  hotelOccupancyTaxRate: number
  strAnnualRegistrationFee: number
  transferTaxRate: number
} {
  const stateBase = STATE_RULES[state] || STATE_RULES['TX']
  // STATE_RULES doesn't carry HOT, STR registration, or transfer tax yet;
  // default each to 0 so callers get a safe baseline (STR opex stack /
  // closing costs). Cities with data flow through CITY_RULES overrides.
  const base = { ...stateBase, hotelOccupancyTaxRate: 0, strAnnualRegistrationFee: 0, transferTaxRate: 0 }
  if (!city) return base
  const key = `${city.trim().toUpperCase()}, ${state.trim().toUpperCase()}`
  const override = CITY_RULES[key]
  if (!override) return base
  return { ...base, ...override }
}

// True when the jurisdiction broadly prohibits non-owner-occupied whole-unit
// STR for an investor buyer. Baltimore (§5A) and NYC Local Law 18 both qualify.
// DC is primary-residence-only but allows a 90-day non-OO carve-out, so it
// is NOT fully prohibited (the DC branch scales revenue to the 90-night cap
// instead of zeroing it out).
export function isStrProhibitedForInvestor(
  state: string,
  city?: string | null
): boolean {
  const stateUp = (state || '').toUpperCase()
  const cityUp = (city || '').toUpperCase().trim()
  if (stateUp === 'MD' && cityUp === 'BALTIMORE') return true
  if (
    stateUp === 'NY' &&
    /\b(NEW YORK|MANHATTAN|BROOKLYN|QUEENS|BRONX|STATEN ISLAND)\b/.test(cityUp)
  ) return true
  return false
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

  // Mortgage payment
  const monthlyMortgagePayment = calculateMortgage(loanAmount, annualRate, amortizationYears)

  // Cash flow
  const effectiveMonthlyRent = rental.estimatedMonthlyRent * (1 - rental.vacancyRate)
  const monthlyNetCashFlow = effectiveMonthlyRent - monthlyMortgagePayment - rental.monthlyExpenses
  const annualNetCashFlow = monthlyNetCashFlow * 12

  // CoC denominator = all capital deployed at close, matching calculateCashToClose
  // (downPayment + 2.5% closing + $1500 inspection + 6mo PITI reserves + rehab).
  // Previously excluded closing/reserves, inflating CoC by 2–4pts vs. IRR basis.
  const closingCosts = purchasePrice * 0.025
  const inspectionAndAppraisal = 1500
  const reserves = (monthlyMortgagePayment + rental.monthlyExpenses) * 6
  const totalCashIn = downPayment + closingCosts + inspectionAndAppraisal + reserves + (rehabBudget || 0)

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

  // Depreciation — only the annualDepreciation and estimatedTaxSaving fields
  // from this helper are consumed below. We compute afterTaxCashFlow ourselves
  // because calculateDepreciation isn't aware of debt service.
  const depr = calculateDepreciation(purchasePrice, noiAnnual + annualDebtService, rental.monthlyExpenses * 12)
  // After-tax cash flow = actual annual cash-in-pocket + the tax shield from
  // depreciation. The helper's own afterTaxCashFlow is NOI-based and omits
  // debt service, so we must recompute from annualNetCashFlow.
  const afterTaxCashFlow = Math.round(annualNetCashFlow + depr.estimatedTaxSaving)

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
    afterTaxCashFlow,
    verdict,
    primaryFailureMode,
    dealScore
  }
}

// All inputs are DECIMAL fractions (coc = 0.08 for 8%, capRate = 0.05 for 5%).
// Thresholds are expressed in the same units so the comparisons are consistent.
// Prior to 2026-04-12 this function had a units mismatch: thresholds were written
// as whole-percent (coc >= 8) but inputs are decimals — DEAL verdict was unreachable.
/**
 * Composite deal score — weights cash flow, DSCR, 5-year IRR, data
 * confidence, and breakeven position into a single 0–100 number. The old
 * score relied on cash flow + CoC + cap rate only, which missed strong
 * appreciation-driven deals (Chicago Bucktown: 0/100 on a 17.5% IRR with
 * +$630K wealth build) and inflated a "Marginal" verdict to 100/100
 * (Arlington VA: 100/100 but verdict MARGINAL). Batch pressure test item
 * #3.
 *
 * Weights (from the pressure test recommendation):
 *   cash flow:            30%
 *   DSCR vs 1.25 thresh:  20%
 *   5-year IRR:           20%
 *   data confidence:      15%
 *   breakeven position:   15%
 */
export function computeCompositeScore(inputs: {
  monthlyNetCashFlow: number
  dscr: number
  irr5yr?: number | null
  valueConfidence?: 'high' | 'medium' | 'low' | null
  offerPrice: number
  breakevenPrice: number
}): number {
  const finite = (v: number | null | undefined, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const monthlyNetCashFlow = finite(inputs.monthlyNetCashFlow, 0)
  const dscr = finite(inputs.dscr, 0)
  const irr5yr = finite(inputs.irr5yr, 0)
  const offerPrice = finite(inputs.offerPrice, 0)
  const breakevenPrice = finite(inputs.breakevenPrice, 0)
  const valueConfidence = inputs.valueConfidence ?? null

  // Cash flow: -$500 = 0, $0 = 50, +$500/mo = 100.
  const cfScore = clamp01((monthlyNetCashFlow + 500) / 1000) * 30

  // DSCR: 0.8 = 0, 1.25 = 50, 1.70 = 100. Linear between.
  const dscrScore = clamp01((dscr - 0.8) / (1.70 - 0.8)) * 20

  // IRR: 0% = 0, 10% = 50, 20% = 100. Clamped.
  const irrScore = clamp01(irr5yr / 0.20) * 20

  // Data confidence: high=15, medium=10, low=5, null=5.
  const confScore =
    valueConfidence === 'high' ? 15 :
    valueConfidence === 'medium' ? 10 : 5

  // Breakeven position: how far below breakeven is the offer? 0% below = 50,
  // 10%+ below = 100, 10%+ above = 0.
  const beRatio = breakevenPrice > 0 ? (breakevenPrice - offerPrice) / breakevenPrice : 0
  const beScore = clamp01(0.5 + beRatio * 5) * 15

  const total = cfScore + dscrScore + irrScore + confScore + beScore
  if (!Number.isFinite(total)) return 0
  return Math.min(100, Math.max(0, Math.round(total)))
}

/**
 * Label band for the composite score so the UI and narrative can agree.
 * Matches the pressure-test recommendation.
 */
export function labelForCompositeScore(score: number): 'Strong' | 'Solid' | 'Marginal' | 'Weak' | 'Fail' {
  if (score >= 80) return 'Strong'
  if (score >= 60) return 'Solid'
  if (score >= 40) return 'Marginal'
  if (score >= 20) return 'Weak'
  return 'Fail'
}

function clamp01(v: number): number { return Math.min(1, Math.max(0, v)) }

function classifyDeal(
  coc: number, capRate: number, monthlyCF: number, dscr: number
): { verdict: 'DEAL' | 'MARGINAL' | 'PASS', primaryFailureMode: string, dealScore: number } {
  const cocScore = Math.min(100, Math.max(0, (coc / 0.08) * 40))
  const capScore = Math.min(100, Math.max(0, (capRate / 0.05) * 30))
  const cfScore = Math.min(100, Math.max(0, ((monthlyCF + 500) / 1000) * 30))
  // The three sub-scores are individually capped at 100, but we weight their
  // contributions at 40/30/30 of a 100-point total — if every sub-score hits
  // its ceiling the sum is 120, not 100. Plus, on a runaway strong deal, one
  // sub-score can drag the others up past 100 and produce nonsensical values
  // like 174/100 (Blacksburg audit). Clamp the total to the 0–100 band.
  const dealScore = Math.min(100, Math.max(0, Math.round(cocScore + capScore + cfScore)))

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
