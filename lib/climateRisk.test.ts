import { describe, it, expect } from 'vitest'
import { estimateInsuranceFast } from './climateRisk'

// Insurance is a top-5 line item in cash flow. If this scaling breaks, every
// Florida / California / Texas cash flow is wrong by hundreds of dollars/month.
describe('estimateInsuranceFast', () => {
  it('returns state-specific baseline at $300k dwelling', () => {
    // Baseline is for $300k; scale factor = 1.0 at that price
    expect(estimateInsuranceFast('FL', 300_000)).toBe(6000)
    expect(estimateInsuranceFast('TX', 300_000)).toBe(4400)
    expect(estimateInsuranceFast('OH', 300_000)).toBe(1100)
  })

  it('scales linearly with dwelling value', () => {
    // $600k should roughly double $300k
    const tx300 = estimateInsuranceFast('TX', 300_000)
    const tx600 = estimateInsuranceFast('TX', 600_000)
    expect(tx600 / tx300).toBeCloseTo(2, 1)
  })

  it('clamps at 0.5× minimum for small dwellings', () => {
    // $50k shouldn't produce near-$0 insurance — clamp floor
    const tx50 = estimateInsuranceFast('TX', 50_000)
    const tx300 = estimateInsuranceFast('TX', 300_000)
    expect(tx50).toBe(Math.round(tx300 * 0.5))
  })

  it('clamps at 3× maximum for luxury dwellings', () => {
    // $10M shouldn't produce $150k/yr insurance — clamp ceiling
    const tx10m = estimateInsuranceFast('TX', 10_000_000)
    const tx300 = estimateInsuranceFast('TX', 300_000)
    expect(tx10m).toBe(Math.round(tx300 * 3))
  })

  it('falls back to national average ($1800) for unknown state', () => {
    expect(estimateInsuranceFast('XX', 300_000)).toBe(1800)
  })

  it('FL is more expensive than OH (reality check)', () => {
    expect(estimateInsuranceFast('FL', 300_000)).toBeGreaterThan(
      estimateInsuranceFast('OH', 300_000)
    )
  })

  it('TX is more expensive than CA (home-insurance reality)', () => {
    // Despite CA high cost of living, TX homeowners insurance averages higher
    // due to hail/wind. Verify our table preserves this.
    expect(estimateInsuranceFast('TX', 300_000)).toBeGreaterThan(
      estimateInsuranceFast('CA', 300_000)
    )
  })
})
