import { describe, it, expect } from 'vitest'
import { applyInvestorPremium, INVESTOR_PREMIUM } from './rates'

// These premiums drive every downstream metric when strategy != PRIMARY.
// If we accidentally revert the premium, DEAL verdicts will silently revert to
// over-optimistic (owner-occupied) math. Regression guards below.
describe('applyInvestorPremium', () => {
  const pmms = 0.065 // 6.50%

  it('LTR adds 75 bps', () => {
    expect(applyInvestorPremium(pmms, 'LTR')).toBeCloseTo(0.0725, 6)
  })

  it('STR adds 100 bps', () => {
    expect(applyInvestorPremium(pmms, 'STR')).toBeCloseTo(0.0750, 6)
  })

  it('FLIP adds 150 bps', () => {
    expect(applyInvestorPremium(pmms, 'FLIP')).toBeCloseTo(0.0800, 6)
  })

  it('PRIMARY adds no premium (owner-occupied)', () => {
    expect(applyInvestorPremium(pmms, 'PRIMARY')).toBe(pmms)
  })

  it('defaults to LTR when strategy omitted (safest investor default)', () => {
    expect(applyInvestorPremium(pmms)).toBeCloseTo(applyInvestorPremium(pmms, 'LTR'), 6)
  })

  it('premium ordering: PRIMARY < LTR < STR < FLIP', () => {
    const p = applyInvestorPremium(pmms, 'PRIMARY')
    const ltr = applyInvestorPremium(pmms, 'LTR')
    const str = applyInvestorPremium(pmms, 'STR')
    const flip = applyInvestorPremium(pmms, 'FLIP')
    expect(p).toBeLessThan(ltr)
    expect(ltr).toBeLessThan(str)
    expect(str).toBeLessThan(flip)
  })

  it('premium is additive, not multiplicative', () => {
    // 6.5% + 0.75% should equal 7.25%, NOT 6.5% × 1.0075 = 6.549%
    expect(applyInvestorPremium(0.065, 'LTR')).toBeCloseTo(0.0725, 6)
    expect(applyInvestorPremium(0.065, 'LTR')).not.toBeCloseTo(0.0655, 3)
  })
})

describe('INVESTOR_PREMIUM constants', () => {
  it('LTR = 75 bps (0.0075)', () => {
    expect(INVESTOR_PREMIUM.LTR).toBe(0.0075)
  })
  it('STR = 100 bps (0.0100)', () => {
    expect(INVESTOR_PREMIUM.STR).toBe(0.01)
  })
  it('FLIP = 150 bps (0.0150)', () => {
    expect(INVESTOR_PREMIUM.FLIP).toBe(0.015)
  })
  it('PRIMARY = 0 (owner-occupied baseline)', () => {
    expect(INVESTOR_PREMIUM.PRIMARY).toBe(0)
  })
})
