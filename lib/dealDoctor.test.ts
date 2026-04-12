import { describe, it, expect } from 'vitest'
import { estimateSTRRevenue } from './dealDoctor'

// STR revenue anchors one of the AI's three fix recommendations. If a 4BR Miami
// property gets the same $4500/mo estimate as a studio, the pivot strategy is
// miscalibrated. These tests guard the bedroom multipliers.
describe('estimateSTRRevenue', () => {
  it('2BR is the city baseline', () => {
    expect(estimateSTRRevenue('Miami', 'FL', 2)).toBe(4500)
    expect(estimateSTRRevenue('Austin', 'TX', 2)).toBe(3500)
  })

  it('3BR is ~1.3× baseline', () => {
    expect(estimateSTRRevenue('Miami', 'FL', 3)).toBe(Math.round(4500 * 1.3))
  })

  it('4BR is ~1.6× baseline', () => {
    expect(estimateSTRRevenue('Miami', 'FL', 4)).toBe(Math.round(4500 * 1.6))
  })

  it('Studio (0BR) is ~0.55× baseline', () => {
    expect(estimateSTRRevenue('Miami', 'FL', 0)).toBe(Math.round(4500 * 0.55))
  })

  it('1BR is ~0.75× baseline', () => {
    expect(estimateSTRRevenue('Miami', 'FL', 1)).toBe(Math.round(4500 * 0.75))
  })

  it('clamps bedroom count to 6 (no infinite scaling)', () => {
    const six = estimateSTRRevenue('Miami', 'FL', 6)
    const ten = estimateSTRRevenue('Miami', 'FL', 10)
    expect(ten).toBe(six)
  })

  it('unknown city falls back to $2500 baseline', () => {
    expect(estimateSTRRevenue('Nowhereville', 'WY', 2)).toBe(2500)
  })

  it('matches city by substring (case-insensitive)', () => {
    // "Los Angeles, CA" should match "los angeles"
    expect(estimateSTRRevenue('LOS ANGELES', 'CA', 2)).toBe(4800)
    expect(estimateSTRRevenue('los angeles', 'CA', 2)).toBe(4800)
  })

  it('no bedrooms = baseline only (no multiplier applied)', () => {
    expect(estimateSTRRevenue('Miami', 'FL')).toBe(4500)
  })

  it('scales monotonically with bedrooms', () => {
    const rev = [0, 1, 2, 3, 4, 5].map((b) => estimateSTRRevenue('Miami', 'FL', b))
    for (let i = 1; i < rev.length; i++) {
      expect(rev[i]).toBeGreaterThan(rev[i - 1])
    }
  })
})
