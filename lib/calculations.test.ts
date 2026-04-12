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
  STATE_RULES,
  getStateFromZipCode,
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
      c.downPayment + c.closingCosts + c.inspectionAndAppraisal + c.reserves + c.rehabBudget
    )
  })

  it('custom reserve months scales linearly', () => {
    const c3 = calculateCashToClose(400_000, 0.2, 0, 2_500, 0.025, 3)
    const c6 = calculateCashToClose(400_000, 0.2, 0, 2_500, 0.025, 6)
    expect(c6.reserves - c3.reserves).toBe(Math.round(2_500 * 3))
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

  it('total wealth is sum of the four components', () => {
    const p = projectWealth(baseParams)
    const y5 = p[4]
    const sum = y5.cumulativeCashFlow + y5.equityFromPaydown + y5.equityFromAppreciation + y5.cumulativeTaxShield
    // Rounding may cause off-by-one on sums
    expect(Math.abs(y5.totalWealthBuilt - sum)).toBeLessThanOrEqual(2)
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
