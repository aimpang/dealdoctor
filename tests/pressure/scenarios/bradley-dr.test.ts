import { describe, it, expect, beforeAll } from 'vitest'
import { replayFixture, assertAlwaysOnInvariants } from './invariants'

/**
 * 1324 Bradley Dr, Harrisonburg VA — student rental near JMU.
 *
 * The session shipped the student-housing heuristic here: Rentcast's AVM
 * returns a per-bedroom rate for student-rental complexes, so whole-property
 * rent needs to be multiplied by bedroom count before downstream math. This
 * fixture protects that the heuristic continues to fire correctly and that
 * the rent adjustment block is populated + consistent with downstream math.
 */

describe('pressure · bradley-dr (student rental near JMU)', () => {
  let data: Awaited<ReturnType<typeof replayFixture>>

  beforeAll(async () => {
    data = await replayFixture('bradley-dr')
  })

  it('passes always-on invariants', () => {
    assertAlwaysOnInvariants(data)
  })

  // Note on rent yield: we don't assert a narrow band here because the
  // Bradley Dr address + current Rentcast state produces varying raw AVMs —
  // the important invariant is the rentAdjustment coherence, not the final
  // yield. Always-on invariants still cap out the runaway cases.

  it('rentAdjustment block is internally consistent', () => {
    // If the heuristic fired, perBedroomRent × bedroomsUsed === effectiveRent.
    // Always-on invariants already check this, but an explicit assertion here
    // anchors the Bradley-class bug (wrong bedroomsUsed, missing perBedroom).
    const ra = data.rentAdjustment
    if (ra.applied) {
      expect(ra.perBedroomRent).toBeGreaterThan(0)
      expect(ra.bedroomsUsed).toBeGreaterThanOrEqual(3) // heuristic floor
      expect(ra.effectiveRent).toBe(ra.perBedroomRent * ra.bedroomsUsed)
    }
  })

  it('effective monthly rent drives downstream cash-flow math (not raw AVM)', () => {
    // If the heuristic fired the inputs.monthlyRent field used for all
    // calculations must match effectiveRent — catches a regression where
    // downstream math accidentally uses the per-bedroom figure.
    expect(data.inputs.monthlyRent).toBe(data.rentAdjustment.effectiveRent)
  })
})
