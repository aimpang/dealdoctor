import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { applyStudentHousingHeuristic } from '../../../lib/studentHousing'

/**
 * The student-housing heuristic gets a dedicated fuzz suite because it has
 * caused production bugs going both ways: false-negative (Bradley Dr),
 * false-positive (216 W Escalones, luxury coastal SFR had rent tripled).
 * Invariants encoded below correspond to the guards added after each
 * Grok audit.
 */
const RUNS = { numRuns: 80 }

describe('fuzz · student-housing heuristic', () => {
  it('never fires on luxury properties (value ≥ $1M) without subdivision match', () => {
    // Escalones class: $2.6M, 3BR, no student-complex subdivision → heuristic
    // must NOT multiply rent. Catches the yield-anomaly branch firing on
    // legit coastal-luxury low-yield deals.
    fc.assert(
      fc.property(
        fc.record({
          rentAvm: fc.double({ min: 2_000, max: 50_000, noNaN: true }),
          propertyValue: fc.double({ min: 1_000_000, max: 10_000_000, noNaN: true }),
          bedrooms: fc.integer({ min: 1, max: 6 }),
        }),
        ({ rentAvm, propertyValue, bedrooms }) => {
          const result = applyStudentHousingHeuristic({
            rentAvm,
            propertyValue,
            bedrooms,
            subdivision: undefined,
          })
          expect(result.isMultiplied, `fired on luxury: $${propertyValue}, ${bedrooms}BR`).toBe(false)
          expect(result.effectiveRent).toBe(rentAvm)
        }
      ),
      RUNS
    )
  })

  it('always fires on known student-complex subdivision matches with bedrooms ≥ 3', () => {
    // Bradley Dr class: in Hunters Ridge / Ashby Crossing → must multiply.
    fc.assert(
      fc.property(
        fc.record({
          rentAvm: fc.double({ min: 300, max: 2_000, noNaN: true }),
          propertyValue: fc.double({ min: 100_000, max: 500_000, noNaN: true }),
          bedrooms: fc.integer({ min: 3, max: 6 }),
          complex: fc.constantFrom(
            'Hunters Ridge',
            'Ashby Crossing',
            'HUNTERS RIDGE at JMU',
            'ASHBY CROSSING phase 2'
          ),
        }),
        ({ rentAvm, propertyValue, bedrooms, complex }) => {
          const result = applyStudentHousingHeuristic({
            rentAvm,
            propertyValue,
            bedrooms,
            subdivision: complex,
          })
          expect(result.isMultiplied, `failed to fire on ${complex}, ${bedrooms}BR`).toBe(true)
          expect(result.bedroomsUsed).toBe(bedrooms)
          // Heuristic rounds internally (see studentHousing.ts:72) so compare
          // against the rounded product, not the raw fp multiplication.
          expect(result.effectiveRent).toBe(Math.round(rentAvm * bedrooms))
        }
      ),
      RUNS
    )
  })

  it('does not fire below the bedroom floor (< 3) even when yield looks anomalous', () => {
    // Studio / 1BR / 2BR rentals never get multiplied — the heuristic is
    // specifically for student rentals which are typically 3+BR.
    fc.assert(
      fc.property(
        fc.record({
          rentAvm: fc.double({ min: 100, max: 1_000, noNaN: true }),
          propertyValue: fc.double({ min: 100_000, max: 400_000, noNaN: true }),
          bedrooms: fc.integer({ min: 1, max: 2 }),
        }),
        ({ rentAvm, propertyValue, bedrooms }) => {
          const result = applyStudentHousingHeuristic({
            rentAvm,
            propertyValue,
            bedrooms,
            subdivision: undefined,
          })
          expect(result.isMultiplied).toBe(false)
          expect(result.effectiveRent).toBe(rentAvm)
        }
      ),
      RUNS
    )
  })

  it('when fired, effectiveRent === perBedroomRent × bedroomsUsed', () => {
    // Invariant: the multiplication math must be consistent. Catches
    // regressions where perBedroomRent is stored as the wrong value.
    fc.assert(
      fc.property(
        fc.record({
          rentAvm: fc.double({ min: 300, max: 2_000, noNaN: true }),
          propertyValue: fc.double({ min: 150_000, max: 400_000, noNaN: true }),
          bedrooms: fc.integer({ min: 4, max: 6 }),
          subdivision: fc.constantFrom('Hunters Ridge', 'Ashby Crossing'),
        }),
        ({ rentAvm, propertyValue, bedrooms, subdivision }) => {
          const result = applyStudentHousingHeuristic({
            rentAvm,
            propertyValue,
            bedrooms,
            subdivision,
          })
          if (result.isMultiplied) {
            // Heuristic rounds both perBedroomRent and effectiveRent, so assert
            // on the rounded product of the persisted pre-round values.
            expect(result.effectiveRent).toBe(
              Math.round(result.perBedroomRent! * result.bedroomsUsed!)
            )
          }
        }
      ),
      RUNS
    )
  })
})
