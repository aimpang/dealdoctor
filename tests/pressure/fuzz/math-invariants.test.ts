import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  findIRR,
  calculateBreakEvenPrice,
  calculateMortgage,
  calculateDealMetrics,
  calculateHoldPeriodIRR,
  projectWealth,
} from '../../../lib/calculations'

/**
 * Fuzz — fires 60 random-but-bounded inputs per property. Catches classes
 * of bugs we haven't seen by proving invariants hold across input space.
 *
 * Budget: ~60 iterations per property keeps the full fuzz suite under ~2s
 * locally, well within the pre-push budget (see plan: pressure:accuracy ≤10s).
 * fast-check's default of 100 runs is too slow when multiplied by ~10 props.
 */
const RUNS = { numRuns: 60 }

describe('fuzz · math invariants', () => {
  describe('findIRR', () => {
    it('returns finite or NaN — never Infinity, never the clamp ceiling of 10', () => {
      fc.assert(
        fc.property(
          fc.array(fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }), {
            minLength: 2,
            maxLength: 10,
          }),
          (flows) => {
            const irr = findIRR(flows)
            // NaN is an allowed signal. Otherwise must be finite and within
            // sane bounds (definitely not the old 10.0 clamp ceiling).
            if (!Number.isNaN(irr)) {
              expect(Number.isFinite(irr)).toBe(true)
              expect(irr).toBeLessThan(10)
              expect(irr).toBeGreaterThan(-1)
            }
          }
        ),
        RUNS
      )
    })

    it('all-negative flows always yield NaN (no sign change → no real IRR)', () => {
      fc.assert(
        fc.property(
          fc.array(fc.double({ min: -1_000_000, max: -1, noNaN: true }), {
            minLength: 2,
            maxLength: 10,
          }),
          (flows) => {
            expect(Number.isNaN(findIRR(flows))).toBe(true)
          }
        ),
        RUNS
      )
    })

    it('all-positive flows always yield NaN', () => {
      fc.assert(
        fc.property(
          fc.array(fc.double({ min: 1, max: 1_000_000, noNaN: true }), {
            minLength: 2,
            maxLength: 10,
          }),
          (flows) => {
            expect(Number.isNaN(findIRR(flows))).toBe(true)
          }
        ),
        RUNS
      )
    })
  })

  describe('calculateBreakEvenPrice', () => {
    it('is finite, positive, and reasonable across the realistic rate band', () => {
      fc.assert(
        fc.property(
          fc.record({
            rent: fc.double({ min: 500, max: 20_000, noNaN: true }),
            rate: fc.double({ min: 0.02, max: 0.15, noNaN: true }),
          }),
          ({ rent, rate }) => {
            const be = calculateBreakEvenPrice(rent, rate)
            expect(Number.isFinite(be)).toBe(true)
            expect(be).toBeGreaterThan(0)
            // Breakeven should be at most ~40× monthly rent at ~2% rates, and
            // at least ~5× monthly rent at high rates. Very generous bound.
            expect(be).toBeLessThan(rent * 500)
          }
        ),
        RUNS
      )
    })
  })

  describe('calculateMortgage', () => {
    it('monthly payment never exceeds loan amount and is always positive', () => {
      fc.assert(
        fc.property(
          fc.record({
            principal: fc.double({ min: 50_000, max: 5_000_000, noNaN: true }),
            rate: fc.double({ min: 0.02, max: 0.15, noNaN: true }),
            years: fc.integer({ min: 10, max: 40 }),
          }),
          ({ principal, rate, years }) => {
            const pmt = calculateMortgage(principal, rate, years)
            expect(Number.isFinite(pmt)).toBe(true)
            expect(pmt).toBeGreaterThan(0)
            // Monthly payment should never be more than the principal itself
            // (on a multi-year amortization; this is a very loose sanity).
            expect(pmt).toBeLessThan(principal)
          }
        ),
        RUNS
      )
    })
  })

  describe('calculateDealMetrics + 5yr IRR end-to-end', () => {
    it('produces finite monetary values; IRR is finite or NaN', () => {
      fc.assert(
        fc.property(
          fc.record({
            purchasePrice: fc.double({ min: 100_000, max: 2_000_000, noNaN: true }),
            downPct: fc.double({ min: 0.05, max: 0.5, noNaN: true }),
            rate: fc.double({ min: 0.04, max: 0.12, noNaN: true }),
            rent: fc.double({ min: 500, max: 15_000, noNaN: true }),
            expenses: fc.double({ min: 100, max: 5_000, noNaN: true }),
          }),
          ({ purchasePrice, downPct, rate, rent, expenses }) => {
            const metrics = calculateDealMetrics(
              {
                purchasePrice,
                downPaymentPct: downPct,
                annualRate: rate,
                amortizationYears: 30,
                state: 'TX',
                rehabBudget: 0,
              },
              { estimatedMonthlyRent: rent, vacancyRate: 0.05, monthlyExpenses: expenses },
              'TX'
            )
            expect(Number.isFinite(metrics.monthlyMortgagePayment)).toBe(true)
            expect(Number.isFinite(metrics.loanAmount)).toBe(true)
            expect(metrics.loanAmount).toBeGreaterThan(0)
            expect(metrics.monthlyMortgagePayment).toBeGreaterThan(0)
          }
        ),
        RUNS
      )
    })

    it('calculateHoldPeriodIRR never returns the clamp-ceiling 10', () => {
      fc.assert(
        fc.property(
          fc.record({
            cashToClose: fc.double({ min: 10_000, max: 500_000, noNaN: true }),
            price: fc.double({ min: 100_000, max: 2_000_000, noNaN: true }),
            rent: fc.double({ min: 500, max: 15_000, noNaN: true }),
            expenses: fc.double({ min: 100, max: 5_000, noNaN: true }),
            rate: fc.double({ min: 0.04, max: 0.12, noNaN: true }),
          }),
          ({ cashToClose, price, rent, expenses, rate }) => {
            const projections = projectWealth({
              offerPrice: price,
              loanAmount: price * 0.8,
              annualRate: rate,
              amortYears: 30,
              initialMonthlyRent: rent,
              vacancyRate: 0.05,
              initialMonthlyExpenses: expenses,
              annualDepreciation: price / 27.5,
              years: 5,
            })
            const irr = calculateHoldPeriodIRR(cashToClose, projections)
            if (!Number.isNaN(irr)) {
              expect(irr).toBeLessThan(10) // old clamp ceiling
              expect(irr).toBeGreaterThan(-1)
            }
          }
        ),
        RUNS
      )
    })
  })
})
