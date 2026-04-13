// Student-rental detection + effective-rent computation.
//
// Rentcast's rent AVM returns per-bedroom rates for student-rental complexes
// (Hunters Ridge at JMU, Ashby Crossing, etc.) because that's how these
// properties actually lease. A 4-bedroom townhome showing "rent: $540/mo"
// is really leasing for $540/room × 4 = $2,160/mo gross.
//
// This module detects the pattern via TWO independent signals and, when
// tripped, multiplies the AVM rent by bedroom count so downstream math
// (breakeven, DSCR, cash flow, wealth) works on realistic whole-property
// income. UI is responsible for showing BOTH figures so users understand
// the transformation.

const KNOWN_STUDENT_COMPLEXES = [
  'HUNTERS RIDGE',     // JMU, Harrisonburg VA
  'ASHBY CROSSING',    // JMU, Harrisonburg VA
  'SUNCHASE',          // JMU, Harrisonburg VA
  'COPPER BEECH',      // national student-housing brand
  'UNIVERSITY',        // generic but catches 'University Place', etc.
  'CAMPUS',            // 'Campus View', 'Campus Walk', etc.
]

export function matchesKnownStudentComplex(subdivision?: string | null): boolean {
  if (!subdivision) return false
  const upper = subdivision.toUpperCase()
  return KNOWN_STUDENT_COMPLEXES.some((p) => upper.includes(p))
}

export interface EffectiveRentResult {
  effectiveRent: number               // used for all downstream math
  perBedroomRent: number | null       // the original AVM, if we multiplied
  bedroomsUsed: number | null         // the multiplier
  isMultiplied: boolean
  reason: 'subdivision-match' | 'yield-anomaly' | null
}

/**
 * Apply the student-housing heuristic: when rent AVM looks like a per-bedroom
 * rate, multiply by bedroom count to estimate whole-property rent.
 *
 * Triggered by either:
 *   (a) Subdivision name matches a known student-rental complex
 *   (b) Bedrooms ≥ 3, current yield < 4%/yr, multiplied yield would fall in
 *       the normal 4–15% rental-yield band.
 *
 * Second criterion catches cases we don't have in the curated list.
 */
export function applyStudentHousingHeuristic(params: {
  rentAvm: number
  propertyValue: number
  bedrooms: number
  subdivision?: string | null
}): EffectiveRentResult {
  const { rentAvm, propertyValue, bedrooms, subdivision } = params

  const defaultResult: EffectiveRentResult = {
    effectiveRent: rentAvm,
    perBedroomRent: null,
    bedroomsUsed: null,
    isMultiplied: false,
    reason: null,
  }

  if (!Number.isFinite(rentAvm) || rentAvm <= 0) return defaultResult
  if (!Number.isFinite(propertyValue) || propertyValue <= 0) return defaultResult
  if (!Number.isFinite(bedrooms) || bedrooms < 3) return defaultResult

  // Signal A: subdivision match — highest confidence
  if (matchesKnownStudentComplex(subdivision)) {
    return {
      effectiveRent: Math.round(rentAvm * bedrooms),
      perBedroomRent: rentAvm,
      bedroomsUsed: bedrooms,
      isMultiplied: true,
      reason: 'subdivision-match',
    }
  }

  // Signal B: yield-anomaly. Current implied yield is impossibly low for a
  // rental (< 4%/yr gross) AND multiplying by bedroom count produces a
  // plausible yield (4-15%). If the multiplied version would also be
  // implausible, DON'T multiply — the data is just broken and a warning
  // (handled elsewhere) is the right response.
  const currentYield = (rentAvm * 12) / propertyValue
  const multipliedYield = (rentAvm * bedrooms * 12) / propertyValue
  if (
    currentYield < 0.04 &&
    multipliedYield >= 0.04 &&
    multipliedYield <= 0.15
  ) {
    return {
      effectiveRent: Math.round(rentAvm * bedrooms),
      perBedroomRent: rentAvm,
      bedroomsUsed: bedrooms,
      isMultiplied: true,
      reason: 'yield-anomaly',
    }
  }

  return defaultResult
}
