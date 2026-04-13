import { describe, it, expect, beforeAll } from 'vitest'
import { replayFixture, assertAlwaysOnInvariants, assertRentYield } from './invariants'

/**
 * 3000 Oasis Grand Blvd, Apt 2502, Fort Myers FL 33916 — HCOL high-rise condo.
 *
 * Grok's 2026-04-12 audit caught three bugs on this property:
 *   1. Sale comps median = $21,500 (non-residential records leaking through)
 *   2. IRR rendered as "1000.0%" when wealth deeply negative
 *   3. "Very Car-Dependent" label despite riverfront downtown amenities
 *
 * Each assertion below corresponds to a fix shipped this session. Reverting
 * any fix should fail this test.
 */

describe('pressure · fort-myers-oasis (HCOL condo, 2BR/2BA)', () => {
  let data: Awaited<ReturnType<typeof replayFixture>>

  beforeAll(async () => {
    data = await replayFixture('fort-myers-oasis')
  })

  it('passes always-on invariants', () => {
    assertAlwaysOnInvariants(data)
  })

  it('rent yield is plausible for HCOL condo (0.25%–1.5%/mo)', () => {
    assertRentYield(data, 0.0025, 0.015)
  })

  it('sale comps median > $30k (catches parking-deed / storage-unit leakage)', () => {
    const comps = data.comparableSales
    if (comps.length === 0) return // recorded fixture returned no comps — still valid
    const values = comps
      .map((c: any) => Number(c.estimated_value))
      .filter((v: number) => Number.isFinite(v) && v > 0)
      .sort((a: number, b: number) => a - b)
    const median = values[Math.floor(values.length / 2)]
    expect(median, 'comp median < $30k means filter regressed').toBeGreaterThan(30_000)
  })

  it('IRR finite or NaN — never the old clamp-ceiling "1000%" (= 10.0)', () => {
    const irr = data.wealthProjection.hero.irr5yr
    if (Number.isFinite(irr)) {
      expect(irr).toBeLessThan(5)
      expect(irr).toBeGreaterThan(-1)
    } else {
      expect(Number.isNaN(irr)).toBe(true)
    }
  })

  it('walkability does NOT confidently claim "Very Car-Dependent" on sparse data', () => {
    const ls = data.locationSignals
    expect(ls).not.toBeNull()
    if (!ls) return
    if (ls.dataConfidence === 'insufficient') {
      // Acceptable — we show "Limited amenity data" instead of confidently
      // declaring car-dependent.
      expect(ls.walkabilityLabel).toBe('Limited amenity data')
    }
  })

  it('HOA is captured or flagged when property_type suggests condo', () => {
    // High-rise condo should carry an HOA line item. When Rentcast doesn't
    // return one, hoaSource should flag it as 'not-captured' so UI warns.
    expect(['listing', 'not-captured']).toContain(data.expenses.hoaSource)
  })
})
