import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { replayFixture, assertAlwaysOnInvariants } from './invariants'

/**
 * 15671 N 29th St, Phoenix AZ — 3BR/2BA townhouse, 1,407 sqft, built 2005,
 * listed $300k.
 *
 * Prior bug caught by Grok: Rentcast's /v1/properties search wasn't narrowed
 * by propertyType, so a townhouse comp query pulled 3BR detached SFRs in the
 * same zip → $460k median on a $300k townhouse → inflated "value spread"
 * warning. Fixed by threading `subject.propertyType` into the Rentcast query
 * for both sale comps and rent comps.
 *
 * Invariants this scenario locks in:
 *   - Every returned sale comp shares the subject's propertyType (no SFR
 *     leakage into a townhouse / condo set)
 *   - Comp median sits within 0.7×–1.4× of subject AVM (much tighter than
 *     the always-on 0.5×–2× guard, because propertyType match should keep
 *     comps in a narrow band)
 *   - Rent comps are all same propertyType as well
 */

describe('pressure · phoenix-townhouse (propertyType-narrowed comps)', () => {
  let data: Awaited<ReturnType<typeof replayFixture>>
  let rawFixture: any

  beforeAll(async () => {
    data = await replayFixture('phoenix-townhouse')
    rawFixture = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', 'fixtures', 'phoenix-townhouse.json'),
        'utf8'
      )
    )
  })

  it('passes always-on invariants', () => {
    assertAlwaysOnInvariants(data)
  })

  it('subject property really is a Townhouse (fixture sanity check)', () => {
    expect(data.property.propertyType).toBe('Townhouse')
  })

  it('sale comp median is within 0.7×–1.4× of subject AVM', () => {
    const subjectAvm = data.property.offerPrice
    const comps = data.comparableSales ?? []
    expect(comps.length).toBeGreaterThanOrEqual(3)

    const values = comps
      .map((c: any) => Number(c.estimated_value))
      .filter((v: number) => Number.isFinite(v) && v > 0)
      .sort((a: number, b: number) => a - b)
    const median = values[Math.floor(values.length / 2)]
    const ratio = median / subjectAvm

    expect(
      ratio,
      `Comp median ${median} vs subject ${subjectAvm} = ${ratio.toFixed(2)}× — tighter than always-on 2× band because propertyType match should hold`
    ).toBeGreaterThan(0.7)
    expect(ratio).toBeLessThan(1.4)
  })

  it('every sale comp shares the subject propertyType (no SFR leakage)', () => {
    // The fixture records the raw Rentcast payload before composeFullReport
    // strips fields. If propertyType isn't in the comp record at all, it
    // means the Rentcast response omitted it — acceptable, we can't assert.
    // But if ANY comp has a propertyType that disagrees, that's the leakage
    // bug resurfacing.
    const rawComps = rawFixture.fetchResults.saleComps.value ?? []
    const subjectType = data.property.propertyType
    for (const c of rawComps) {
      if (c.propertyType && c.propertyType !== subjectType) {
        throw new Error(
          `Comp ${c.address} is a ${c.propertyType}, subject is ${subjectType} — propertyType filter regression`
        )
      }
    }
  })

  it('rent comps all share subject propertyType (no SFR leakage on rent side)', () => {
    const rentComps = rawFixture.fetchResults.rentComps.value ?? []
    const subjectType = data.property.propertyType
    for (const c of rentComps) {
      if (c.propertyType && c.propertyType !== subjectType) {
        throw new Error(
          `Rent comp ${c.address} is a ${c.propertyType}, subject is ${subjectType} — propertyType filter regression`
        )
      }
    }
  })

  it('breakeven delta narrow enough to flag as near-miss, not extreme', () => {
    // Grok's framing: "near-miss deal" at $300k listing. The |delta|/offer
    // ratio should be small — not a $-wildly-above-breakeven or $-wildly-below.
    const delta = data.breakeven.delta
    const offer = data.breakeven.yourOffer
    const ratio = Math.abs(delta) / offer
    expect(
      ratio,
      `|delta|/offer = ${(ratio * 100).toFixed(1)}% — should be <40% for a near-miss`
    ).toBeLessThan(0.4)
  })
})
