import { describe, it, expect } from 'vitest'
import {
  calculateMortgage,
  calculateDSCR,
  calculateBreakEvenPrice,
  calculateDepreciation,
  calculateDealMetrics,
  calculateRenewalScenarios,
  calculateCashToClose,
  projectWealth,
  findIRR,
  calculateHoldPeriodIRR,
  calculateFinancingAlternatives,
  calculateSensitivity,
  calculateRecommendedOffers,
  calculateSTRProjection,
  getStatePropertyTaxGrowth,
  STATE_RULES,
  getStateFromZipCode,
  isStrProhibitedForInvestor,
  getJurisdictionRules,
} from './calculations'

// Verified against Bankrate's mortgage calculator. If any of these change,
// every downstream metric (cash flow, DSCR, cap rate, breakeven) is wrong.
describe('calculateMortgage', () => {
  it('matches Bankrate for $300k @ 7.00% 30yr', () => {
    const pmt = calculateMortgage(300_000, 0.07, 30)
    expect(pmt).toBeCloseTo(1995.91, 1)
  })

  it('matches Bankrate for $100k @ 6.00% 30yr', () => {
    const pmt = calculateMortgage(100_000, 0.06, 30)
    expect(pmt).toBeCloseTo(599.55, 1)
  })

  it('matches Bankrate for $500k @ 5.00% 15yr', () => {
    const pmt = calculateMortgage(500_000, 0.05, 15)
    expect(pmt).toBeCloseTo(3953.97, 1)
  })

  it('handles 0% rate as straight-line division', () => {
    expect(calculateMortgage(120_000, 0, 10)).toBe(1000) // 120k / 120 months
  })

  it('scales linearly with principal at same rate', () => {
    const a = calculateMortgage(100_000, 0.06, 30)
    const b = calculateMortgage(300_000, 0.06, 30)
    expect(b / a).toBeCloseTo(3, 4)
  })
})

describe('calculateDSCR', () => {
  it('returns NOI/debt-service', () => {
    expect(calculateDSCR(24_000, 20_000)).toBe(1.2)
  })

  it('returns 0 when debt service is 0 (guard against div-by-zero)', () => {
    expect(calculateDSCR(24_000, 0)).toBe(0)
  })

  it('returns 0 for negative debt service', () => {
    expect(calculateDSCR(24_000, -1)).toBe(0)
  })

  it('matches lender threshold at DSCR=1.25', () => {
    // Common DSCR loan minimum: 1.25x
    expect(calculateDSCR(25_000, 20_000)).toBe(1.25)
  })
})

describe('calculateBreakEvenPrice', () => {
  it('converges to a sane positive number', () => {
    const be = calculateBreakEvenPrice(2000, 0.07)
    expect(be).toBeGreaterThan(50_000)
    expect(be).toBeLessThan(3_000_000)
  })

  it('higher rent produces higher breakeven (monotonic)', () => {
    const lowRent = calculateBreakEvenPrice(1500, 0.07)
    const highRent = calculateBreakEvenPrice(3000, 0.07)
    expect(highRent).toBeGreaterThan(lowRent)
  })

  it('higher rate produces lower breakeven (monotonic)', () => {
    const lowRate = calculateBreakEvenPrice(2000, 0.05)
    const highRate = calculateBreakEvenPrice(2000, 0.08)
    expect(highRate).toBeLessThan(lowRate)
  })

  it('rounds to nearest $1000', () => {
    const be = calculateBreakEvenPrice(2000, 0.07)
    expect(be % 1000).toBe(0)
  })
})

describe('calculateDepreciation', () => {
  it('depreciates 80% of basis over 27.5 years', () => {
    const d = calculateDepreciation(300_000, 30_000, 12_000)
    // building value = 240k; /27.5 = 8,727
    expect(d.annualDepreciation).toBe(8727)
    expect(d.buildingValue).toBe(240_000)
  })

  it('estimates tax saving at ~28% of depreciation', () => {
    const d = calculateDepreciation(300_000, 30_000, 12_000)
    expect(d.estimatedTaxSaving).toBe(Math.round(8727 * 0.28))
  })

  it('scales linearly with purchase price', () => {
    const a = calculateDepreciation(200_000, 20_000, 8_000).annualDepreciation
    const b = calculateDepreciation(400_000, 40_000, 16_000).annualDepreciation
    expect(b / a).toBeCloseTo(2, 1)
  })
})

describe('calculateDealMetrics', () => {
  const baseInputs = {
    purchasePrice: 300_000,
    downPaymentPct: 0.20,
    annualRate: 0.07,
    amortizationYears: 30,
    state: 'TX',
  }
  const baseRental = {
    estimatedMonthlyRent: 2_500,
    vacancyRate: 0.05,
    monthlyExpenses: 500,
  }

  it('loan amount = price × (1 - down%)', () => {
    const m = calculateDealMetrics(baseInputs, baseRental, 'TX')
    expect(m.loanAmount).toBe(240_000)
  })

  it('LTV = loan / price', () => {
    const m = calculateDealMetrics(baseInputs, baseRental, 'TX')
    expect(m.ltv).toBeCloseTo(0.80, 2)
  })

  it('cash-on-cash uses downPayment + rehab (not just downPayment)', () => {
    const withoutRehab = calculateDealMetrics(baseInputs, baseRental, 'TX')
    const withRehab = calculateDealMetrics(
      { ...baseInputs, rehabBudget: 30_000 },
      baseRental,
      'TX'
    )
    // Same annual cash flow, bigger denominator → lower CoC
    expect(withRehab.cashOnCashReturn).toBeLessThan(withoutRehab.cashOnCashReturn)
  })

  it('cap rate = NOI / purchase price', () => {
    const m = calculateDealMetrics(baseInputs, baseRental, 'TX')
    const expectedCapRate =
      ((baseRental.estimatedMonthlyRent * (1 - baseRental.vacancyRate) - baseRental.monthlyExpenses) *
        12) /
      baseInputs.purchasePrice
    expect(m.capRate).toBeCloseTo(Math.round(expectedCapRate * 10000) / 100, 1)
  })

  // Blacksburg audit: classifyDeal returned 174/100 on a runaway strong deal
  // because the three sub-scores (capped individually at 100) summed above
  // their 40/30/30 weighting. Enforced total cap at 100.
  it('dealScore is capped at 100 even on runaway strong deals', () => {
    const m = calculateDealMetrics(
      { ...baseInputs, purchasePrice: 540_000, downPaymentPct: 0.20 },
      { estimatedMonthlyRent: 5_100, vacancyRate: 0.05, monthlyExpenses: 500 },
      'VA'
    )
    expect(m.dealScore).toBeGreaterThanOrEqual(0)
    expect(m.dealScore).toBeLessThanOrEqual(100)
  })

  it('verdict is PASS when cash flow is sharply negative', () => {
    const m = calculateDealMetrics(
      baseInputs,
      { ...baseRental, estimatedMonthlyRent: 800 }, // rent way too low
      'TX'
    )
    expect(m.verdict).toBe('PASS')
    expect(m.monthlyNetCashFlow).toBeLessThan(-500)
  })

  it('verdict is DEAL when CoC ≥ 8%, cash flow ≥ 0, DSCR ≥ 1.25', () => {
    const m = calculateDealMetrics(
      { ...baseInputs, purchasePrice: 150_000 }, // cheap property
      { ...baseRental, estimatedMonthlyRent: 2_500, monthlyExpenses: 300 },
      'TX'
    )
    expect(m.cashOnCashReturn).toBeGreaterThanOrEqual(8)
    expect(m.monthlyNetCashFlow).toBeGreaterThanOrEqual(0)
    expect(m.dscr).toBeGreaterThanOrEqual(1.25)
    expect(m.verdict).toBe('DEAL')
  })
})

describe('calculateRenewalScenarios', () => {
  it('produces one scenario per refi rate (5% → 8% in 0.5% steps)', () => {
    const scenarios = calculateRenewalScenarios(240_000, 0.07, 30, 5, 2500, 0.05, 500)
    // Implementation tests rates [0.05, 0.055, 0.06, 0.065, 0.07, 0.075, 0.08]
    expect(scenarios).toHaveLength(7)
  })

  it('higher refi rate → higher payment', () => {
    const scenarios = calculateRenewalScenarios(240_000, 0.07, 30, 5, 2500, 0.05, 500)
    for (let i = 1; i < scenarios.length; i++) {
      expect(scenarios[i].monthlyPayment).toBeGreaterThanOrEqual(scenarios[i - 1].monthlyPayment)
    }
  })

  it('viability flag flips at negative cash flow > $100/mo', () => {
    const scenarios = calculateRenewalScenarios(240_000, 0.07, 30, 5, 2500, 0.05, 500)
    for (const s of scenarios) {
      expect(s.viable).toBe(s.monthlyCashFlow >= -100)
    }
  })
})

describe('STATE_RULES', () => {
  it('flags CA and NY as rent-control states', () => {
    expect(STATE_RULES.CA.rentControl).toBe(true)
    expect(STATE_RULES.NY.rentControl).toBe(true)
  })

  it('flags TX and FL as landlord-friendly', () => {
    expect(STATE_RULES.TX.landlordFriendly).toBe(true)
    expect(STATE_RULES.FL.landlordFriendly).toBe(true)
  })

  it('TX has highest property tax among common markets', () => {
    // TX 1.8% famously high — make sure we reflect that
    expect(STATE_RULES.TX.propertyTaxRate).toBeGreaterThan(STATE_RULES.CA.propertyTaxRate)
    expect(STATE_RULES.TX.propertyTaxRate).toBeGreaterThan(STATE_RULES.FL.propertyTaxRate)
  })
})

// --- CASH TO CLOSE ---
// Investors underwrite from total capital required. If this math is wrong, users
// commit to deals they can't actually close.
describe('calculateCashToClose', () => {
  it('down = offer × down%', () => {
    const c = calculateCashToClose(400_000, 0.2, 0, 2_500)
    expect(c.downPayment).toBe(80_000)
  })

  it('closing costs = 2.5% of offer by default', () => {
    const c = calculateCashToClose(400_000, 0.2, 0, 2_500)
    expect(c.closingCosts).toBe(10_000)
  })

  it('reserves = 6 × monthly PITI by default', () => {
    const c = calculateCashToClose(400_000, 0.2, 0, 2_500)
    expect(c.reserves).toBe(15_000)
  })

  it('total includes rehab', () => {
    const withRehab = calculateCashToClose(400_000, 0.2, 30_000, 2_500)
    const withoutRehab = calculateCashToClose(400_000, 0.2, 0, 2_500)
    expect(withRehab.totalCashToClose - withoutRehab.totalCashToClose).toBe(30_000)
  })

  it('total is sum of all components', () => {
    const c = calculateCashToClose(400_000, 0.2, 30_000, 2_500)
    expect(c.totalCashToClose).toBe(
      c.downPayment + c.closingCosts + c.transferTax + c.inspectionAndAppraisal + c.reserves + c.rehabBudget
    )
  })

  it('custom reserve months scales linearly', () => {
    const c3 = calculateCashToClose(400_000, 0.2, 0, 2_500, 0.025, 3)
    const c6 = calculateCashToClose(400_000, 0.2, 0, 2_500, 0.025, 6)
    expect(c6.reserves - c3.reserves).toBe(Math.round(2_500 * 3))
  })

  it('transfer tax is zero by default and scales with offer price', () => {
    const baseline = calculateCashToClose(400_000, 0.2, 0, 2_500)
    expect(baseline.transferTax).toBe(0)
    // NYC buyer-side transfer ≈ 1.825% on $400K = $7,300.
    const nyc = calculateCashToClose(400_000, 0.2, 0, 2_500, 0.025, 6, 0.01825)
    expect(nyc.transferTax).toBe(7_300)
    expect(nyc.totalCashToClose - baseline.totalCashToClose).toBe(7_300)
  })
})

// --- WEALTH PROJECTION ---
describe('projectWealth', () => {
  const baseParams = {
    offerPrice: 400_000,
    loanAmount: 320_000,
    annualRate: 0.07,
    amortYears: 30,
    initialMonthlyRent: 3_000,
    vacancyRate: 0.05,
    initialMonthlyExpenses: 800,
    annualDepreciation: 11_636,
    years: 5,
  }

  it('returns one entry per year', () => {
    const p = projectWealth(baseParams)
    expect(p).toHaveLength(5)
    expect(p[0].year).toBe(1)
    expect(p[4].year).toBe(5)
  })

  it('loan balance decreases monotonically (paydown)', () => {
    const p = projectWealth(baseParams)
    for (let i = 1; i < p.length; i++) {
      expect(p[i].loanBalance).toBeLessThan(p[i - 1].loanBalance)
    }
  })

  it('property value grows monotonically with default appreciation', () => {
    const p = projectWealth(baseParams)
    for (let i = 1; i < p.length; i++) {
      expect(p[i].propertyValue).toBeGreaterThan(p[i - 1].propertyValue)
    }
  })

  it('cumulative tax shield = years × annual depreciation × effective tax rate', () => {
    const p = projectWealth(baseParams)
    const expected = Math.round(baseParams.annualDepreciation * 0.28) * 5
    expect(Math.abs(p[4].cumulativeTaxShield - expected)).toBeLessThan(5)
  })

  it('total wealth = cashFlow + equity + taxShield − depreciationRecapture', () => {
    const p = projectWealth(baseParams)
    const y5 = p[4]
    const sum =
      y5.cumulativeCashFlow +
      y5.equityFromPaydown +
      y5.equityFromAppreciation +
      y5.cumulativeTaxShield -
      y5.depreciationRecaptureTax
    // Rounding may cause off-by-one on sums
    expect(Math.abs(y5.totalWealthBuilt - sum)).toBeLessThanOrEqual(2)
  })

  it('depreciation recapture = cumulative depreciation × 25% (IRS §1250)', () => {
    const p = projectWealth(baseParams)
    const y5 = p[4]
    expect(y5.cumulativeDepreciation).toBe(Math.round(baseParams.annualDepreciation * 5))
    expect(y5.depreciationRecaptureTax).toBe(Math.round(y5.cumulativeDepreciation * 0.25))
  })

  it('0% rent growth and 0% appreciation = no appreciation equity', () => {
    const p = projectWealth({ ...baseParams, rentGrowthRate: 0, appreciationRate: 0 })
    expect(p[4].equityFromAppreciation).toBe(0)
  })
})

// --- IRR ---
describe('findIRR', () => {
  it('returns 0 for flat zero flows', () => {
    expect(findIRR([-1000, 1000])).toBeCloseTo(0, 2)
  })

  it('matches a simple known IRR: invest $1000, get $1100 back in year 1 → 10%', () => {
    expect(findIRR([-1000, 1100])).toBeCloseTo(0.10, 2)
  })

  it('matches a 2-year IRR: invest $1000, get $1210 in year 2 → 10%', () => {
    expect(findIRR([-1000, 0, 1210])).toBeCloseTo(0.10, 2)
  })

  it('handles negative IRR when flows show a loss', () => {
    const r = findIRR([-1000, 500])
    expect(r).toBeLessThan(0)
  })

  // Regression: deep-loss scenarios used to return the clamp ceiling of 10
  // (rendering as "1000.0%") when Newton-Raphson failed to converge — caught
  // on the Fort Myers high-rise condo audit 2026-04-12. Now NaN so the UI can
  // show "N/A" rather than a nonsense rate.
  it('returns NaN when all flows are negative (no sign change → undefined IRR)', () => {
    expect(Number.isNaN(findIRR([-1000, -200, -200, -200]))).toBe(true)
  })
  it('returns NaN when all flows are positive (no investment → undefined IRR)', () => {
    expect(Number.isNaN(findIRR([1000, 200, 200]))).toBe(true)
  })
  it('returns NaN on deeply-negative-equity 5yr hold instead of the 1000% clamp ceiling', () => {
    // Invest $100k, lose every year, net-negative sale proceeds. Old code hit
    // the rate=10 clamp and rendered as 1000%.
    const deepLoss = findIRR([-100_000, -10_000, -10_000, -10_000, -10_000, -200_000])
    expect(Number.isNaN(deepLoss)).toBe(true)
  })
})

describe('calculateHoldPeriodIRR', () => {
  it('returns a reasonable rate for a realistic 5-year hold', () => {
    const projections = projectWealth({
      offerPrice: 400_000,
      loanAmount: 320_000,
      annualRate: 0.0725,
      amortYears: 30,
      initialMonthlyRent: 3_500,
      vacancyRate: 0.05,
      initialMonthlyExpenses: 800,
      annualDepreciation: 11_636,
      years: 5,
    })
    const irr = calculateHoldPeriodIRR(100_000, projections)
    // Should be positive for a cash-flowing deal with appreciation
    expect(irr).toBeGreaterThan(0)
    // And not absurd
    expect(irr).toBeLessThan(1)
  })

  it('returns 0 when projections are empty', () => {
    expect(calculateHoldPeriodIRR(100_000, [])).toBe(0)
  })
})

// --- FINANCING ALTERNATIVES ---
describe('calculateFinancingAlternatives', () => {
  const baseParams = {
    offerPrice: 400_000,
    pmmsRate: 0.065,
    monthlyRent: 3_000,
    vacancyRate: 0.05,
    monthlyExpenses: 800,
    rehabBudget: 0,
  }

  it('returns FHA, Conventional, and DSCR options', () => {
    const alts = calculateFinancingAlternatives(baseParams)
    const ids = alts.map((a) => a.id)
    expect(ids).toContain('fha')
    expect(ids).toContain('conventional')
    expect(ids).toContain('dscr')
  })

  it('FHA has lowest down payment', () => {
    const alts = calculateFinancingAlternatives(baseParams)
    const fha = alts.find((a) => a.id === 'fha')!
    const others = alts.filter((a) => a.id !== 'fha')
    for (const o of others) {
      expect(fha.downPaymentPct).toBeLessThan(o.downPaymentPct)
    }
  })

  it('DSCR rate is higher than Conventional rate (no-doc premium)', () => {
    const alts = calculateFinancingAlternatives(baseParams)
    const conv = alts.find((a) => a.id === 'conventional')!
    const dscr = alts.find((a) => a.id === 'dscr')!
    expect(dscr.annualRate).toBeGreaterThan(conv.annualRate)
  })

  it('each alternative has a monthly cash flow computed consistently with its rate/down', () => {
    const alts = calculateFinancingAlternatives(baseParams)
    for (const a of alts) {
      // loan = price - down, then payment = calcMortgage
      const loan = baseParams.offerPrice - a.downPayment
      const payment = calculateMortgage(loan, a.annualRate, a.amortYears)
      expect(Math.abs(a.monthlyPayment - Math.round(payment))).toBeLessThanOrEqual(1)
    }
  })

  it('each alternative has a positive cash-to-close', () => {
    const alts = calculateFinancingAlternatives(baseParams)
    for (const a of alts) {
      expect(a.cashToClose).toBeGreaterThan(0)
    }
  })

  it('FHA cash-to-close is less than Conventional (lower down)', () => {
    const alts = calculateFinancingAlternatives(baseParams)
    const fha = alts.find((a) => a.id === 'fha')!
    const conv = alts.find((a) => a.id === 'conventional')!
    expect(fha.cashToClose).toBeLessThan(conv.cashToClose)
  })
})

// --- SENSITIVITY ---
// Guards the "how safe is this deal?" section. If these relationships break,
// investors looking for stress-test signals will see nonsense.
// DC Apolline regression — the hero IRR (−13.8% on zip-derived −1%
// appreciation) contradicted the sensitivity Base-case IRR (+6.8% because
// the table hardcoded 3% appreciation). Now Base case uses the hero's
// actual appreciation rate when supplied.
describe('calculateSensitivity — Base-case IRR consistency with hero', () => {
  const inputs = {
    offerPrice: 266_000,
    downPaymentPct: 0.20,
    annualRate: 0.0725,
    monthlyRent: 2_100,
    vacancyRate: 0.05,
    monthlyExpenses: 800,
    rehabBudget: 0,
    annualDepreciation: 7_730,
    cashToClose: 60_000,
  }

  it('Base case uses baseAppreciationRate when provided', () => {
    const withRate = calculateSensitivity({ ...inputs, baseAppreciationRate: -0.01 })
    const base = withRate.find((r) => r.scenario === 'Base case')!
    expect(base.description).toContain('-1.0%')
  })

  it('defaults to 3% appreciation description when baseAppreciationRate is omitted', () => {
    const legacy = calculateSensitivity(inputs)
    const base = legacy.find((r) => r.scenario === 'Base case')!
    expect(base.description).toContain('3.0%')
  })

  it('Base-case IRR shifts when appreciation shifts (sanity: negative appreciation lowers IRR)', () => {
    const positive = calculateSensitivity({ ...inputs, baseAppreciationRate: 0.03 })
    const negative = calculateSensitivity({ ...inputs, baseAppreciationRate: -0.01 })
    const pBase = positive.find((r) => r.scenario === 'Base case')!
    const nBase = negative.find((r) => r.scenario === 'Base case')!
    // Either both finite with neg < pos, or negative went to NaN (acceptable)
    if (Number.isFinite(nBase.fiveYrIRR) && Number.isFinite(pBase.fiveYrIRR)) {
      expect(nBase.fiveYrIRR).toBeLessThan(pBase.fiveYrIRR)
    }
  })

  it('rent and expense growth propagate through to the projection', () => {
    const noGrowth = calculateSensitivity({
      ...inputs,
      baseAppreciationRate: 0.03,
      baseRentGrowthRate: 0,
      baseExpenseGrowthRate: 0,
    })
    const withGrowth = calculateSensitivity({
      ...inputs,
      baseAppreciationRate: 0.03,
      baseRentGrowthRate: 0.05,
      baseExpenseGrowthRate: 0.025,
    })
    const noBase = noGrowth.find((r) => r.scenario === 'Base case')!
    const grBase = withGrowth.find((r) => r.scenario === 'Base case')!
    // Higher rent growth → more wealth over 5 years (not strictly monotonic
    // in every knob combo, but this one is).
    expect(grBase.fiveYrWealth).toBeGreaterThan(noBase.fiveYrWealth)
  })
})

describe('calculateSensitivity', () => {
  const baseInputs = {
    offerPrice: 400_000,
    downPaymentPct: 0.20,
    annualRate: 0.0725,
    monthlyRent: 3_000,
    vacancyRate: 0.05,
    monthlyExpenses: 900,
    rehabBudget: 0,
    annualDepreciation: 11_636,
    cashToClose: 105_000,
  }

  it('includes all 7 scenarios (base + 6 perturbations)', () => {
    const rows = calculateSensitivity(baseInputs)
    expect(rows).toHaveLength(7)
    const names = rows.map((r) => r.scenario.toLowerCase())
    expect(names.some((n) => n.includes('base'))).toBe(true)
    expect(names.some((n) => n.includes('rent −10'))).toBe(true)
    expect(names.some((n) => n.includes('rent +10'))).toBe(true)
    expect(names.some((n) => n.includes('rate +1'))).toBe(true)
    expect(names.some((n) => n.includes('expenses +20'))).toBe(true)
    expect(names.some((n) => n.includes('appreciation 0'))).toBe(true)
    expect(names.some((n) => n.includes('appreciation 5'))).toBe(true)
  })

  it('rent −10% reduces monthly cash flow vs base', () => {
    const rows = calculateSensitivity(baseInputs)
    const base = rows.find((r) => r.scenario.toLowerCase().includes('base'))!
    const rentDown = rows.find((r) => r.scenario.toLowerCase().includes('rent −10'))!
    expect(rentDown.monthlyCashFlow).toBeLessThan(base.monthlyCashFlow)
  })

  it('rent +10% increases monthly cash flow vs base', () => {
    const rows = calculateSensitivity(baseInputs)
    const base = rows.find((r) => r.scenario.toLowerCase().includes('base'))!
    const rentUp = rows.find((r) => r.scenario.toLowerCase().includes('rent +10'))!
    expect(rentUp.monthlyCashFlow).toBeGreaterThan(base.monthlyCashFlow)
  })

  it('rate +1% reduces both cash flow and 5yr wealth', () => {
    const rows = calculateSensitivity(baseInputs)
    const base = rows.find((r) => r.scenario.toLowerCase().includes('base'))!
    const rateUp = rows.find((r) => r.scenario.toLowerCase().includes('rate +1'))!
    expect(rateUp.monthlyCashFlow).toBeLessThan(base.monthlyCashFlow)
    expect(rateUp.fiveYrWealth).toBeLessThan(base.fiveYrWealth)
  })

  it('expenses +20% reduces cash flow and DSCR', () => {
    const rows = calculateSensitivity(baseInputs)
    const base = rows.find((r) => r.scenario.toLowerCase().includes('base'))!
    const expUp = rows.find((r) => r.scenario.toLowerCase().includes('expenses +20'))!
    expect(expUp.monthlyCashFlow).toBeLessThan(base.monthlyCashFlow)
    expect(expUp.dscr).toBeLessThan(base.dscr)
  })

  it('appreciation 0% reduces 5yr wealth; appreciation 5% increases it', () => {
    const rows = calculateSensitivity(baseInputs)
    const base = rows.find((r) => r.scenario.toLowerCase().includes('base'))!
    const apprZero = rows.find((r) => r.scenario.toLowerCase().includes('appreciation 0'))!
    const apprFive = rows.find((r) => r.scenario.toLowerCase().includes('appreciation 5'))!
    expect(apprZero.fiveYrWealth).toBeLessThan(base.fiveYrWealth)
    expect(apprFive.fiveYrWealth).toBeGreaterThan(base.fiveYrWealth)
  })

  it('base row has zero delta vs itself', () => {
    const rows = calculateSensitivity(baseInputs)
    const base = rows.find((r) => r.scenario.toLowerCase().includes('base'))!
    expect(base.cashFlowDelta).toBe(0)
    expect(base.wealthDelta).toBe(0)
  })
})

// --- RECOMMENDED OFFERS ---
// Guards the "max offer for target return" feature — if this breaks, buyers
// get false confidence offering too much.
describe('calculateRecommendedOffers', () => {
  const baseParams = {
    monthlyRent: 3_000,
    vacancyRate: 0.05,
    annualRate: 0.0725,
    downPaymentPct: 0.20,
    rehabBudget: 0,
    propertyTaxRate: 0.018,
    monthlyInsurance: 400,
    monthlyMaintenance: 150,
    monthlyHOA: 0,
    targetCoC: 0.08,
    targetIRR: 0.10,
  }

  it('returns prices for all three targets', () => {
    const r = calculateRecommendedOffers(baseParams)
    expect(r.breakevenPrice).toBeGreaterThan(0)
    // CoC/IRR may be 0 if no price clears the target — but should always be non-negative
    expect(r.priceForCashOnCash.maxPrice).toBeGreaterThanOrEqual(0)
    expect(r.priceForIRR.maxPrice).toBeGreaterThanOrEqual(0)
  })

  it('stricter CoC target yields lower max price (monotonic)', () => {
    const loose = calculateRecommendedOffers({ ...baseParams, targetCoC: 0.04 })
    const strict = calculateRecommendedOffers({ ...baseParams, targetCoC: 0.12 })
    // Only compare when both produced a valid price
    if (loose.priceForCashOnCash.maxPrice > 0 && strict.priceForCashOnCash.maxPrice > 0) {
      expect(strict.priceForCashOnCash.maxPrice).toBeLessThan(loose.priceForCashOnCash.maxPrice)
    }
  })

  it('breakeven price is positive for any cashflowing rent/rate combo', () => {
    const r = calculateRecommendedOffers(baseParams)
    expect(r.breakevenPrice).toBeGreaterThan(50_000)
    expect(r.breakevenPrice).toBeLessThan(3_000_000)
  })

  it('higher rate lowers breakeven price (rate stress sensitivity)', () => {
    const lowRate = calculateRecommendedOffers({ ...baseParams, annualRate: 0.05 })
    const highRate = calculateRecommendedOffers({ ...baseParams, annualRate: 0.08 })
    expect(highRate.breakevenPrice).toBeLessThan(lowRate.breakevenPrice)
  })
})

// --- STATE PROPERTY TAX GROWTH ---
describe('getStatePropertyTaxGrowth', () => {
  it('CA Prop 13 caps at 2%', () => {
    expect(getStatePropertyTaxGrowth('CA')).toBe(0.02)
  })
  it('TX has no cap on investor properties — higher than default', () => {
    expect(getStatePropertyTaxGrowth('TX')).toBeGreaterThan(0.03)
  })
  it('FL non-homestead sees materially higher growth than default', () => {
    expect(getStatePropertyTaxGrowth('FL')).toBeGreaterThan(0.03)
  })
  it('states with assessment caps are below default (MI, OR, AZ, CA)', () => {
    for (const s of ['MI', 'OR', 'AZ', 'CA']) {
      expect(getStatePropertyTaxGrowth(s)).toBeLessThanOrEqual(0.03)
    }
  })
  it('unknown state falls back to 3%', () => {
    expect(getStatePropertyTaxGrowth('ZZ')).toBe(0.03)
  })

  // Deal score cap (Blacksburg audit: was 174/100) — no calculations.test.ts
  // entry currently, but the contract says dealScore ∈ [0, 100]. The
  // pressure-suite invariant 12 already enforces this against fixtures.
  // Inline sanity check via calculateDealMetrics would require too much
  // scaffolding — the unit is covered by the pressure suite instead.
  it('every value is in a sane band (0%-10%)', () => {
    for (const s of ['CA', 'TX', 'FL', 'NY', 'OH', 'GA', 'CO', 'WA', 'IL', 'AZ']) {
      const v = getStatePropertyTaxGrowth(s)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(0.10)
    }
  })
})

// --- STR PROJECTION ---
describe('calculateSTRProjection', () => {
  const baseParams = {
    monthlyGrossRevenue: 4_500,
    monthlyMortgagePayment: 2_000,
    monthlyPropertyTax: 450,
    monthlyInsuranceLTR: 300,
    monthlyLTRCashFlow: 300,
  }

  it('opex ratio sums the five variable components (~43% of gross)', () => {
    const r = calculateSTRProjection(baseParams)
    // management 20 + cleaning 10 + supplies 6 + utilities 7 + insurance(50% of LTR)
    // variable portion: 43% of gross
    expect(r.opExRatio).toBeCloseTo(0.43, 2)
  })

  it('STR insurance is 50% higher than LTR insurance', () => {
    const r = calculateSTRProjection(baseParams)
    expect(r.breakdown.insurance).toBe(Math.round(baseParams.monthlyInsuranceLTR * 1.5))
  })

  it('net cash flow = gross - mortgage - opex', () => {
    const r = calculateSTRProjection(baseParams)
    expect(r.monthlyNetCashFlow).toBe(
      Math.round(baseParams.monthlyGrossRevenue - baseParams.monthlyMortgagePayment - r.monthlyOpex)
    )
  })

  it('vsLTRMonthlyDelta is STR CF minus LTR CF', () => {
    const r = calculateSTRProjection(baseParams)
    expect(r.vsLTRMonthlyDelta).toBe(r.monthlyNetCashFlow - baseParams.monthlyLTRCashFlow)
  })

  it('higher gross revenue produces higher net (monotonic)', () => {
    const lower = calculateSTRProjection({ ...baseParams, monthlyGrossRevenue: 3_000 })
    const higher = calculateSTRProjection({ ...baseParams, monthlyGrossRevenue: 6_000 })
    expect(higher.monthlyNetCashFlow).toBeGreaterThan(lower.monthlyNetCashFlow)
  })

  it('DSCR uses annualized NOI / annual debt service', () => {
    const r = calculateSTRProjection(baseParams)
    const expectedDSCR =
      Math.round((r.annualNOI / (baseParams.monthlyMortgagePayment * 12)) * 100) / 100
    expect(r.annualDSCR).toBeCloseTo(expectedDSCR, 2)
  })

  it('breakdown values sum (plus fixed costs) to monthly opex', () => {
    const r = calculateSTRProjection(baseParams)
    const sum =
      r.breakdown.management +
      r.breakdown.cleaning +
      r.breakdown.suppliesAndPlatformFees +
      r.breakdown.utilities +
      r.breakdown.propertyTax +
      r.breakdown.insurance +
      r.breakdown.hotelOccupancyTax +
      r.breakdown.strRegistrationFee
    expect(sum).toBe(r.monthlyOpex)
  })

  it('STR registration fee amortizes annual fee to monthly and deducts from net CF', () => {
    const without = calculateSTRProjection(baseParams)
    const withFee = calculateSTRProjection({ ...baseParams, strAnnualRegistrationFee: 275 })
    expect(withFee.breakdown.strRegistrationFee).toBe(Math.round(275 / 12))
    expect(withFee.monthlyNetCashFlow).toBe(without.monthlyNetCashFlow - Math.round(275 / 12))
  })

  it('hotel occupancy tax is deducted when jurisdiction provides a rate', () => {
    const without = calculateSTRProjection(baseParams)
    const withHot = calculateSTRProjection({ ...baseParams, hotelOccupancyTaxRate: 0.13 })
    const expectedHot = Math.round(baseParams.monthlyGrossRevenue * 0.13)
    expect(withHot.breakdown.hotelOccupancyTax).toBe(expectedHot)
    expect(withHot.monthlyNetCashFlow).toBe(without.monthlyNetCashFlow - expectedHot)
    // opExRatio scales with gross, so adding 13% HOT bumps ~0.43 → ~0.56.
    expect(withHot.opExRatio).toBeCloseTo(without.opExRatio + 0.13, 2)
  })
})

describe('getStateFromZipCode', () => {
  it('resolves NY (10001)', () => {
    expect(getStateFromZipCode('10001')).toBe('NY')
  })
  it('resolves CA (90001)', () => {
    expect(getStateFromZipCode('90001')).toBe('CA')
  })
  it('resolves TX (78701)', () => {
    expect(getStateFromZipCode('78701')).toBe('TX')
  })
  it('resolves FL (33101)', () => {
    expect(getStateFromZipCode('33101')).toBe('FL')
  })
  it('strips non-digits (ZIP+4)', () => {
    expect(getStateFromZipCode('78701-1234')).toBe('TX')
  })
})

// --- STATE_RULES coverage (regression for silent TX fallback) ---
// The audit turned up that ~32 states weren't in STATE_RULES. Any of them
// would silently inherit Texas's 1.8% property-tax rate and STR narrative,
// which made reports for NM, HI, AK, NJ, AR, etc. arithmetically wrong
// without surfacing any warning. These tests lock in full 50-state coverage.
describe('STATE_RULES coverage', () => {
  const ALL_50_STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
    'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
    'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
    'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  ]

  it('every US state is defined (no silent TX fallback)', () => {
    for (const s of ALL_50_STATES) {
      expect(STATE_RULES[s], `Missing STATE_RULES entry for ${s}`).toBeDefined()
    }
  })

  it('DC is defined', () => {
    expect(STATE_RULES['DC']).toBeDefined()
  })

  it('every propertyTaxRate is in a sane band (0.1% – 3%)', () => {
    for (const s of ALL_50_STATES) {
      const r = STATE_RULES[s].propertyTaxRate
      expect(r, `${s} tax rate ${r} out of band`).toBeGreaterThan(0.001)
      expect(r).toBeLessThan(0.03)
    }
  })

  it('NM is NOT treated as Texas (audit-specific regression)', () => {
    // Pre-fix: STATE_RULES['NM'] || STATE_RULES['TX'] fell through to 1.8%.
    // Post-fix: NM's own 0.76% effective rate applies — ~2.5× lower tax.
    expect(STATE_RULES['NM'].propertyTaxRate).toBeLessThan(0.015)
    expect(STATE_RULES['NM'].name).toBe('New Mexico')
  })

  it('NJ has a very high effective rate (>2%)', () => {
    expect(STATE_RULES['NJ'].propertyTaxRate).toBeGreaterThan(0.02)
  })

  it('HI has a very low effective rate (<0.5%)', () => {
    expect(STATE_RULES['HI'].propertyTaxRate).toBeLessThan(0.005)
  })

  // DC Dupont Circle audit: rate was 0.6% (undershoot). Actual effective
  // rate ~0.85% — the regulations section understated property tax for
  // any DC property without a county-record override.
  it('DC is >= 0.8% (corrected from prior 0.6%)', () => {
    expect(STATE_RULES['DC'].propertyTaxRate).toBeGreaterThanOrEqual(0.008)
    expect(STATE_RULES['DC'].propertyTaxRate).toBeLessThan(0.01)
  })
})

// --- calculateBreakEvenPrice with expense opts ---
// Regression for Bug B: the solver used to hardcode 20% down + 1.5% tax/ins +
// $250 ops. That produced a wrong breakeven for Chicago high-rise condos
// (HOA-heavy, IL 2.1% tax), low-tax CA coastal condos, and anything not on
// a 20% down loan. The new signature lets callers pass actual deal inputs.
describe('calculateBreakEvenPrice with expense opts', () => {
  it('defaults still produce a sane positive number (backward-compat)', () => {
    const be = calculateBreakEvenPrice(2000, 0.07)
    expect(be).toBeGreaterThan(50_000)
    expect(be).toBeLessThan(3_000_000)
  })

  it('higher propertyTaxRate lowers breakeven (more expense eats rent)', () => {
    const low = calculateBreakEvenPrice(2500, 0.07, { propertyTaxRate: 0.007 })  // HI-style
    const high = calculateBreakEvenPrice(2500, 0.07, { propertyTaxRate: 0.022 }) // NJ-style
    expect(high).toBeLessThan(low)
  })

  it('adding monthlyHOA lowers breakeven (condo case)', () => {
    const noHoa = calculateBreakEvenPrice(2500, 0.07, { monthlyHOA: 0 })
    const condo = calculateBreakEvenPrice(2500, 0.07, { monthlyHOA: 500 })
    expect(condo).toBeLessThan(noHoa)
  })

  it('higher downPaymentPct raises breakeven (smaller loan, lower payment)', () => {
    const twenty = calculateBreakEvenPrice(2500, 0.07, { downPaymentPct: 0.20 })
    const forty = calculateBreakEvenPrice(2500, 0.07, { downPaymentPct: 0.40 })
    expect(forty).toBeGreaterThan(twenty)
  })

  it('Chicago high-rise condo: IL 2.1% + $500 HOA produces a lower breakeven than TX SFR', () => {
    // Rough regression for the audit's Bug B — a condo with heavy HOA + IL
    // rate should NOT share breakeven with a TX SFR at the same rent/rate.
    const chicagoCondo = calculateBreakEvenPrice(2500, 0.07, {
      propertyTaxRate: 0.021,
      monthlyInsurance: 150,
      monthlyHOA: 500,
    })
    const tulsaSfr = calculateBreakEvenPrice(2500, 0.07, {
      propertyTaxRate: 0.009,
      monthlyInsurance: 100,
      monthlyHOA: 0,
    })
    expect(chicagoCondo).toBeLessThan(tulsaSfr)
  })

  // Dynamic ceiling — luxury subjects ($3M+) used to be clamped by the flat
  // 3_000_000 ceiling. Regression for the Old Westbury audit (Bug 8).
  it('dynamic ceiling scales with offerPrice (no $3M clamp)', () => {
    // High rent + low rate on a $4M-subject should push breakeven above $3M.
    // Without the dynamic ceiling the solver would clamp at/near 3M.
    const be = calculateBreakEvenPrice(30_000, 0.04, {
      offerPrice: 4_000_000,
      monthlyHOA: 0,
    })
    expect(be).toBeGreaterThan(3_000_000)
    expect(be).toBeLessThan(8_000_000)
  })

  it('default call still caps at ~$3M ceiling (backward compat when offerPrice omitted)', () => {
    const be = calculateBreakEvenPrice(30_000, 0.04)
    expect(be).toBeLessThanOrEqual(3_000_000)
  })
})

// calculateRecommendedOffers regression — breakeven must match the one the
// standalone solver produces given the same expense inputs. The Old Westbury
// audit hit "two different breakeven numbers in the same report" because
// recommendedOffers was calling calculateBreakEvenPrice(rent, rate) with no
// expense opts, so it silently used the defaults while the hero used actuals.
describe('calculateRecommendedOffers breakeven consistency', () => {
  const baseParams = {
    monthlyRent: 5_000,
    vacancyRate: 0.05,
    annualRate: 0.07,
    downPaymentPct: 0.20,
    rehabBudget: 0,
    propertyTaxRate: 0.017,
    monthlyInsurance: 250,
    monthlyMaintenance: 228,
    monthlyHOA: 0,
  }

  it('uses the passed expense stack, not solver defaults', () => {
    const recOffers = calculateRecommendedOffers(baseParams)
    const direct = calculateBreakEvenPrice(baseParams.monthlyRent, baseParams.annualRate, {
      downPaymentPct: baseParams.downPaymentPct,
      propertyTaxRate: baseParams.propertyTaxRate,
      monthlyInsurance: baseParams.monthlyInsurance,
      monthlyHOA: baseParams.monthlyHOA,
      monthlyMaintenance: baseParams.monthlyMaintenance,
    })
    expect(recOffers.breakevenPrice).toBe(direct)
  })

  it('offerPrice is forwarded for luxury subjects', () => {
    const recOffers = calculateRecommendedOffers({
      ...baseParams,
      monthlyRent: 30_000,
      annualRate: 0.04,
      offerPrice: 4_000_000,
    })
    expect(recOffers.breakevenPrice).toBeGreaterThan(3_000_000)
  })
})

// Bug 4 regression — NY strNotes used to apply the NYC STR ban to all of NY
// state, misrepresenting Long Island, Hudson Valley, and upstate.
describe('STATE_RULES["NY"].strNotes scope', () => {
  it('scopes the ban to NYC / five boroughs rather than statewide', () => {
    const notes = STATE_RULES['NY'].strNotes
    // Must explicitly call out NYC vs the rest of the state.
    expect(notes.toLowerCase()).toMatch(/nyc|five boroughs/i)
    expect(notes.toLowerCase()).toMatch(/rules vary|elsewhere|non-nyc|outside/i)
  })
})

// Bug regression — Baltimore City §5A bans non-owner-occupied whole-unit STR.
// Prior to the fix an investor report on 414 Water St #1501 still listed
// "no state-level STR restrictions" as a pro and included a 60%-occupancy
// strProjection — contradicting the report's own stateRules.strNotes.
describe('isStrProhibitedForInvestor', () => {
  it('flags Baltimore, MD as STR-prohibited for investors', () => {
    expect(isStrProhibitedForInvestor('MD', 'Baltimore')).toBe(true)
    expect(isStrProhibitedForInvestor('MD', 'baltimore')).toBe(true)
    expect(isStrProhibitedForInvestor('MD', '  Baltimore  ')).toBe(true)
  })
  it('flags NYC boroughs (NY Local Law 18)', () => {
    expect(isStrProhibitedForInvestor('NY', 'New York')).toBe(true)
    expect(isStrProhibitedForInvestor('NY', 'Brooklyn')).toBe(true)
    expect(isStrProhibitedForInvestor('NY', 'Queens')).toBe(true)
  })
  it('does NOT flag non-banned jurisdictions', () => {
    expect(isStrProhibitedForInvestor('MD', 'Annapolis')).toBe(false)
    expect(isStrProhibitedForInvestor('NY', 'Albany')).toBe(false)
    expect(isStrProhibitedForInvestor('TX', 'Austin')).toBe(false)
    // DC has a 90-night carve-out (not fully prohibited) — handled by the
    // DC-specific occupancy-scaling branch in reportGenerator, not here.
    expect(isStrProhibitedForInvestor('DC', 'Washington')).toBe(false)
  })
  it('handles null/empty city safely', () => {
    expect(isStrProhibitedForInvestor('MD', null)).toBe(false)
    expect(isStrProhibitedForInvestor('MD', '')).toBe(false)
    expect(isStrProhibitedForInvestor('', null)).toBe(false)
  })
})

describe('getJurisdictionRules', () => {
  it('applies Phoenix STR lodging tax instead of falling back to zero', () => {
    const rules = getJurisdictionRules('AZ', 'Phoenix')

    expect(rules.hotelOccupancyTaxRate).toBeCloseTo(0.1257, 4)
    expect(rules.strNotes).toMatch(/transient|lodging|tax/i)
  })
})
