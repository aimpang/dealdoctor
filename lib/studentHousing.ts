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

  // Signal A: subdivision match — highest confidence. Allows bedrooms >= 3
  // because some Hunters-Ridge-style townhomes are 3BR.
  if (matchesKnownStudentComplex(subdivision)) {
    return {
      effectiveRent: Math.round(rentAvm * bedrooms),
      perBedroomRent: rentAvm,
      bedroomsUsed: bedrooms,
      isMultiplied: true,
      reason: 'subdivision-match',
    }
  }

  // Signal B: yield-anomaly. Stricter requirements than subdivision-match
  // because this is the path most likely to mis-fire on legitimate low-yield
  // markets (California coastal, Manhattan, etc.). We require:
  //   - bedrooms >= 4 (student rentals typically lease 4+ rooms; 3BR at low
  //     yield in an expensive market is normal, not per-bedroom data)
  //   - propertyValue < $800k (prices this high are structurally low-yield;
  //     the 216 W Escalones San Clemente case is $2.6M @ 3BR — should NEVER
  //     trigger the multiplier)
  //   - current yield < 4% AND multiplied yield in normal 4-15% range
  const currentYield = (rentAvm * 12) / propertyValue
  const multipliedYield = (rentAvm * bedrooms * 12) / propertyValue
  if (
    bedrooms >= 4 &&
    propertyValue < 800_000 &&
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
