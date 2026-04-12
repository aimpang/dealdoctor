import { describe, it, expect } from 'vitest'
import {
  calculateMortgage,
  calculateDSCR,
  calculateBreakEvenPrice,
  calculateDepreciation,
  calculateDealMetrics,
  calculateRenewalScenarios,
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
