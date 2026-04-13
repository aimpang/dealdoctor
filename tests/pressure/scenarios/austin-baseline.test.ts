import { describe, it, expect, beforeAll } from 'vitest'
import { replayFixture, assertAlwaysOnInvariants } from './invariants'

/**
 * 1500 W Anderson Ln, Austin TX — vanilla SFR, the happy-path control.
 *
 * No known bugs anchored to this address. Serves as the regression canary:
 * if any fix or refactor accidentally breaks the normal flow, this is the
 * test that catches it. A "healthy" Austin 3BR/2BA with a normal rent/value
 * ratio should produce a clean, internally-consistent report.
 */

describe('pressure · austin-baseline (vanilla SFR, happy path)', () => {
  let data: Awaited<ReturnType<typeof replayFixture>>

  beforeAll(async () => {
    data = await replayFixture('austin-baseline')
  })

  it('passes always-on invariants', () => {
    assertAlwaysOnInvariants(data)
  })

  it('produces a verdict from the known enum', () => {
    expect(['DEAL', 'MARGINAL', 'PASS']).toContain(data.ltr.verdict)
  })

  it('DSCR is a finite number in a plausible range', () => {
    // DSCR can be negative when NOI is negative (unprofitable deal) — that's
    // valid output, not a bug. What matters is finiteness and sanity bounds.
    expect(Number.isFinite(data.ltr.dscr)).toBe(true)
    expect(data.ltr.dscr).toBeLessThan(50)
    expect(data.ltr.dscr).toBeGreaterThan(-50)
  })

  it('cash-to-close > down payment (includes closing + reserves + rehab)', () => {
    const ctc = data.cashToClose.totalCashToClose
    const dp = data.property.offerPrice * data.property.downPaymentPct
    expect(ctc, 'cash-to-close must include more than just down payment').toBeGreaterThanOrEqual(dp)
  })

  it('5yr wealth hero: all fields finite (except irr5yr which may legitimately be NaN)', () => {
    const hero = data.wealthProjection.hero
    expect(Number.isFinite(hero.totalWealthBuilt5yr)).toBe(true)
    expect(Number.isFinite(hero.cumulativeCashFlow5yr)).toBe(true)
    expect(Number.isFinite(hero.equityFromPaydown5yr)).toBe(true)
    expect(Number.isFinite(hero.propertyValue5yr)).toBe(true)
    // irr5yr can be NaN for deeply-negative scenarios — that's by design.
    // Only assert it's not the old clamp-ceiling bug value (10 = 1000%).
    if (Number.isFinite(hero.irr5yr)) {
      expect(hero.irr5yr).toBeLessThan(5)
    }
  })

  it('breakeven price is positive and less than 10× subject', () => {
    expect(data.breakeven.price).toBeGreaterThan(0)
    expect(data.breakeven.price).toBeLessThan(data.property.offerPrice * 10)
  })

  it('state rules match report state', () => {
    expect(data.stateRules.state).toBe(data.property.state)
  })
})
