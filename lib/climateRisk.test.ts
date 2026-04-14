import { describe, it, expect } from 'vitest'
import { estimateInsuranceFast, applyInlandHurricaneSuppression } from './climateRisk'

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

// Blacksburg VA regression — an inland mountain town at 2,000ft and 250mi
// from the coast was getting Virginia's state-level hurricane score (3) and
// the Deal Doctor AI was writing "Virginia coastal hurricane and tropical
// storm exposure." applyInlandHurricaneSuppression drops the score when
// longitude indicates the property is well inland.
describe('applyInlandHurricaneSuppression', () => {
  it('Blacksburg VA (lng -80.42) suppresses hurricane to 0 (well inland)', () => {
    // Threshold for VA is -78.0. -80.42 is 2.42° west of threshold → deep inland.
    expect(applyInlandHurricaneSuppression(3, 'VA', -80.42)).toBe(0)
  })

  it('Virginia Beach VA (lng -75.98) keeps the full hurricane score (coastal)', () => {
    expect(applyInlandHurricaneSuppression(3, 'VA', -75.98)).toBe(3)
  })

  it('marginal inland (just past threshold) reduces to 1, not 0', () => {
    // VA threshold -78.0. lng -78.5 is only 0.5° inland — remnants can reach.
    expect(applyInlandHurricaneSuppression(3, 'VA', -78.5)).toBe(1)
  })

  it('returns the raw score when longitude is missing', () => {
    expect(applyInlandHurricaneSuppression(4, 'NC', null)).toBe(4)
    expect(applyInlandHurricaneSuppression(4, 'NC', undefined)).toBe(4)
  })

  it('returns the raw score for states without an inland threshold (FL, MS)', () => {
    expect(applyInlandHurricaneSuppression(5, 'FL', -82)).toBe(5)
    expect(applyInlandHurricaneSuppression(5, 'MS', -90)).toBe(5)
  })

  it('works for TX deep inland (El Paso at lng -106)', () => {
    expect(applyInlandHurricaneSuppression(4, 'TX', -106.5)).toBe(0)
  })

  it('works for NY inland (Buffalo at lng -78.87)', () => {
    // NY threshold -74.5. Buffalo at -78.87 is 4.37° inland → 0.
    expect(applyInlandHurricaneSuppression(2, 'NY', -78.87)).toBe(0)
  })
})
