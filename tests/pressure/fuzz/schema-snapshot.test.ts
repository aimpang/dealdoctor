import { describe, it, expect } from 'vitest'
import { replayFixture, EXPECTED_FULL_REPORT_KEYS } from '../scenarios/invariants'

/**
 * Schema snapshot — ensures the top-level key set of `fullReportData`
 * doesn't silently drift. When a real change ships (add/remove/rename a
 * section), update EXPECTED_FULL_REPORT_KEYS in invariants.ts intentionally.
 *
 * Why this matters: the UI consumes `fullReportData` by destructuring top-
 * level keys. A missing key renders as `undefined` and produces silent
 * visual regressions — no runtime error, no failing test, just a blank
 * section where comps should be.
 */

describe('fuzz · schema snapshot', () => {
  it('top-level keys are stable across all scenario fixtures', async () => {
    const slugs = [
      'fort-myers-oasis',
      'bradley-dr',
      'escalones',
      'austin-baseline',
      'phoenix-townhouse',
    ]
    for (const slug of slugs) {
      const data = await replayFixture(slug)
      expect(
        Object.keys(data).sort(),
        `schema drift on ${slug} — update EXPECTED_FULL_REPORT_KEYS`
      ).toEqual(EXPECTED_FULL_REPORT_KEYS)
    }
  })
})
