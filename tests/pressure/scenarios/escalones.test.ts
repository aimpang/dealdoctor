import { describe, it, expect, beforeAll } from 'vitest'
import { replayFixture, assertAlwaysOnInvariants } from './invariants'

/**
 * 216 W Escalones, San Clemente CA — luxury coastal SFR.
 *
 * Grok's 2026-04-12 audit caught the student-housing heuristic false-
 * positiving here: this 3BR $2.6M coastal luxury home had its legit $7k/mo
 * rent tripled to $21k because the yield-anomaly branch fired on what is
 * simply a legit low-yield market. Fix added bedrooms≥4 AND value<$800k
 * guards on the yield-anomaly path.
 *
 * This fixture protects that:
 *   - heuristic does NOT fire on luxury coastal properties
 *   - the rent stays at the raw AVM value
 */

describe('pressure · escalones (luxury coastal SFR, 3BR)', () => {
  let data: Awaited<ReturnType<typeof replayFixture>>

  beforeAll(async () => {
    data = await replayFixture('escalones')
  })

  it('passes always-on invariants', () => {
    assertAlwaysOnInvariants(data)
  })

  it('student-housing heuristic does NOT fire on luxury coastal SFR', () => {
    // Primary protection against the Escalones false-positive. If this
    // property has value > $800k AND bedrooms < 4 AND no student-subdivision
    // match, the heuristic must not multiply the rent.
    const ra = data.rentAdjustment
    expect(ra.applied, 'heuristic should not fire on luxury SFR — check bedroom/value guards').toBe(false)
    expect(ra.perBedroomRent).toBeNull()
    expect(ra.bedroomsUsed).toBeNull()
  })

  it('effectiveRent equals raw AVM (no multiplication happened)', () => {
    const ra = data.rentAdjustment
    expect(ra.applied).toBe(false)
    // When heuristic didn't apply, effective rent should equal what Rentcast's
    // AVM returned. If a regression re-enables the heuristic for this property,
    // effective rent would jump by ~3× and this would fail.
    expect(data.inputs.monthlyRent).toBe(ra.effectiveRent)
  })

  it('value confidence is not "high" given wide AVM range (catches over-claim)', () => {
    // Escalones had a Rentcast AVM range spanning ~49% (from ~$1.97M to ~$3.25M).
    // Our valueTriangulation should reflect that uncertainty — we previously
    // showed it as "high confidence" because there was only one signal.
    const vt = data.valueTriangulation
    // Spread > 25% should downgrade to medium or low
    if (vt.spreadPct > 25) {
      expect(vt.confidence, 'wide AVM spread must not read as high confidence').not.toBe('high')
    }
  })
})
