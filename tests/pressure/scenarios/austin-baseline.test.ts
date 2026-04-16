import { describe, it, expect, beforeAll } from 'vitest'
import { replayFixture } from './invariants'
import { QualityAuditError } from '../../../lib/qualityAudit'

/**
 * 1500 W Anderson Ln, Austin TX — recorded provider mismatch.
 *
 * The current fixture resolves to a "Land" parcel with a ~$27.5M assessed
 * value, not a real residential subject we can underwrite. This test locks
 * in the launch-safe behavior: block unsupported property classes instead of
 * treating them as houses and emitting garbage math.
 */

describe('pressure · austin-baseline (unsupported property gate)', () => {
  let error: unknown

  beforeAll(async () => {
    try {
      await replayFixture('austin-baseline')
    } catch (err) {
      error = err
    }
  })

  it('blocks fixture replay with a quality audit error', () => {
    expect(error).toBeInstanceOf(QualityAuditError)
  })

  it('identifies the unsupported land parcel explicitly', () => {
    const audit = (error as QualityAuditError).audit
    expect(audit.status).toBe('blocked')
    expect(audit.hardFailures.map((f) => f.code)).toContain('unsupported-property-type')
    expect(audit.stages.propertyProfile.summary).toMatch(/unsupported/i)
  })

  it('does not misclassify the parcel as a supported residential subject', () => {
    const audit = (error as QualityAuditError).audit
    const unsupported = audit.hardFailures.find((f) => f.code === 'unsupported-property-type')
    expect(unsupported?.message).toMatch(/Land/i)
  })
})
