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

// College-town ZIP codes where Rentcast's rent AVM frequently returns per-
// bedroom rates even without a known student-complex subdivision match, and
// even when property value crosses the yield-anomaly price ceiling. Expand
// this list as new false negatives surface. Grow conservatively — including
// a non-student zip here would double-count whole-property rent.
export const COLLEGE_TOWN_ZIPS: Record<string, string> = {
  '24060': 'Virginia Tech (Blacksburg, VA)',
  '24061': 'Virginia Tech (Blacksburg, VA)',
  '22801': 'James Madison University (Harrisonburg, VA)',
  '22807': 'James Madison University (Harrisonburg, VA)',
  '22903': 'University of Virginia (Charlottesville, VA)',
  '22904': 'University of Virginia (Charlottesville, VA)',
  '16801': 'Penn State (State College, PA)',
  '16802': 'Penn State (State College, PA)',
  '47906': 'Purdue (West Lafayette, IN)',
  '47907': 'Purdue (West Lafayette, IN)',
  '61801': 'UIUC (Champaign, IL)',
  '61820': 'UIUC (Champaign, IL)',
  '48104': 'University of Michigan (Ann Arbor, MI)',
  '48109': 'University of Michigan (Ann Arbor, MI)',
  '27514': 'UNC Chapel Hill (Chapel Hill, NC)',
  '27516': 'UNC Chapel Hill (Chapel Hill, NC)',
  '27707': 'Duke (Durham, NC)',
  '29208': 'University of South Carolina (Columbia, SC)',
  '30602': 'University of Georgia (Athens, GA)',
  '32611': 'University of Florida (Gainesville, FL)',
  '37916': 'University of Tennessee (Knoxville, TN)',
  '40506': 'University of Kentucky (Lexington, KY)',
  '43210': 'Ohio State (Columbus, OH)',
  '44106': 'Case Western (Cleveland, OH)',
  '53706': 'UW–Madison (Madison, WI)',
  '55455': 'University of Minnesota (Minneapolis, MN)',
  '65211': 'University of Missouri (Columbia, MO)',
  '70803': 'LSU (Baton Rouge, LA)',
  '73019': 'University of Oklahoma (Norman, OK)',
  '77840': 'Texas A&M (College Station, TX)',
  '78712': 'UT Austin (Austin, TX)',
  '80309': 'CU Boulder (Boulder, CO)',
  '84112': 'University of Utah (Salt Lake City, UT)',
  '85281': 'Arizona State (Tempe, AZ)',
  '85719': 'University of Arizona (Tucson, AZ)',
  '92093': 'UCSD (La Jolla, CA)',
  '94305': 'Stanford (Stanford, CA)',
  '94720': 'UC Berkeley (Berkeley, CA)',
  '98195': 'University of Washington (Seattle, WA)',
}

export function collegeTownForZip(zipCode?: string | null): string | null {
  if (!zipCode) return null
  const z = zipCode.trim().slice(0, 5)
  return COLLEGE_TOWN_ZIPS[z] ?? null
}

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
  reason: 'subdivision-match' | 'yield-anomaly' | 'college-town' | null
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
  zipCode?: string | null
}): EffectiveRentResult {
  const { rentAvm, propertyValue, bedrooms, subdivision, zipCode } = params

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
  // markets (California coastal, Manhattan, etc.). Two sub-gates:
  //
  //   B1 "standard": bedrooms >= 4, propertyValue < $800k. Catches the classic
  //      student-rental townhome pattern (4+BR at a middle-market price).
  //
  //   B2 "low-price 3BR": bedrooms === 3, propertyValue < $300k. At this
  //      price tier a CA-coastal false positive is impossible — the 216 W
  //      Escalones case ($2.6M @ 3BR) can't reach here. Covers near-campus
  //      3BR houses in affordable college towns (Fayetteville AR, Starkville
  //      MS, Bloomington IN) where Rentcast still returns per-bedroom rates
  //      even without a named student complex.
  //
  // Both gates still require currentYield < 4% AND multiplied yield in the
  // normal 4–15% band — so the heuristic only fires when the arithmetic is
  // consistent with a per-bedroom AVM.
  const currentYield = (rentAvm * 12) / propertyValue
  const multipliedYield = (rentAvm * bedrooms * 12) / propertyValue

  const gateB1 = bedrooms >= 4 && propertyValue < 800_000
  const gateB2 = bedrooms === 3 && propertyValue < 300_000
  const yieldsConsistent =
    currentYield < 0.04 && multipliedYield >= 0.04 && multipliedYield <= 0.15

  if ((gateB1 || gateB2) && yieldsConsistent) {
    return {
      effectiveRent: Math.round(rentAvm * bedrooms),
      perBedroomRent: rentAvm,
      bedroomsUsed: bedrooms,
      isMultiplied: true,
      reason: 'yield-anomaly',
    }
  }

  // Signal C: college-town ZIP. When the property sits in a known college-town
  // ZIP, relax the price/bedroom gates — bedrooms >= 3 + current yield < 5% +
  // multiplied yield in the normal range is enough. This catches the
  // Blacksburg VA case where a $540k 3BR condo near Virginia Tech has a
  // per-bedroom AVM but the $800k value cap blocks gate B1 and the $300k cap
  // blocks B2. The ZIP constraint prevents this from firing on any
  // random low-yield market — only college towns we've curated.
  const inCollegeTownZip = collegeTownForZip(zipCode) !== null
  const collegeTownYieldOk =
    currentYield < 0.05 && multipliedYield >= 0.04 && multipliedYield <= 0.15
  if (inCollegeTownZip && bedrooms >= 3 && collegeTownYieldOk) {
    return {
      effectiveRent: Math.round(rentAvm * bedrooms),
      perBedroomRent: rentAvm,
      bedroomsUsed: bedrooms,
      isMultiplied: true,
      reason: 'college-town',
    }
  }

  return defaultResult
}

/**
 * Cross-check a multiplied rent against the highest actual rent comp nearby.
 * When the heuristic pushes rent above 2× the max comp, the source AVM was
 * almost certainly already a whole-unit figure (not per-bedroom) and the
 * multiplication over-corrected. Revert to the raw AVM in that case.
 *
 * Blacksburg regression: $1,700 AVM × 3 = $5,100, but actual 3BR whole-unit
 * comps topped at $2,225. Over-correction flipped the verdict from PASS to
 * STRONG DEAL on fake numbers.
 *
 * Returns a revised adjustment (possibly unchanged) + a flag indicating
 * whether the revert fired, so callers can push the right warning. Pure
 * function — both the preview route and composeFullReport call this after
 * they have rent comps available.
 */
export function crossCheckRentAgainstComps(params: {
  adjustment: EffectiveRentResult
  rawRentAvm: number
  rentCompRents: number[]
}): { adjustment: EffectiveRentResult; revertedDueToComps: boolean } {
  const { adjustment, rawRentAvm, rentCompRents } = params
  if (!adjustment.isMultiplied) return { adjustment, revertedDueToComps: false }
  if (!Array.isArray(rentCompRents) || rentCompRents.length === 0) {
    return { adjustment, revertedDueToComps: false }
  }
  const maxRentComp = rentCompRents
    .filter((v) => Number.isFinite(v) && v > 0)
    .reduce((m, v) => (v > m ? v : m), 0)
  if (maxRentComp <= 0) return { adjustment, revertedDueToComps: false }
  if (adjustment.effectiveRent <= maxRentComp * 2) {
    return { adjustment, revertedDueToComps: false }
  }
  return {
    adjustment: {
      effectiveRent: Math.round(rawRentAvm),
      perBedroomRent: null,
      bedroomsUsed: null,
      isMultiplied: false,
      reason: null,
    },
    revertedDueToComps: true,
  }
}
