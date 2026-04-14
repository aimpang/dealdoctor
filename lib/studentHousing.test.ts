import { describe, it, expect } from 'vitest'
import {
  matchesKnownStudentComplex,
  applyStudentHousingHeuristic,
  collegeTownForZip,
  COLLEGE_TOWN_ZIPS,
  crossCheckRentAgainstComps,
} from './studentHousing'

describe('matchesKnownStudentComplex', () => {
  it('matches Hunters Ridge (JMU)', () => {
    expect(matchesKnownStudentComplex('PHASE B HUNTERS RIDGE TOWNHOUSES')).toBe(true)
  })
  it('matches Ashby Crossing', () => {
    expect(matchesKnownStudentComplex('Ashby Crossing')).toBe(true)
  })
  it('matches generic "University Place"', () => {
    expect(matchesKnownStudentComplex('University Place Condominiums')).toBe(true)
  })
  it('is case-insensitive', () => {
    expect(matchesKnownStudentComplex('hunters ridge')).toBe(true)
  })
  it('returns false for normal subdivisions', () => {
    expect(matchesKnownStudentComplex('Brookside Estates')).toBe(false)
  })
  it('returns false for undefined / null / empty', () => {
    expect(matchesKnownStudentComplex(undefined)).toBe(false)
    expect(matchesKnownStudentComplex(null)).toBe(false)
    expect(matchesKnownStudentComplex('')).toBe(false)
  })
})

describe('applyStudentHousingHeuristic — subdivision match', () => {
  it('multiplies rent × bedrooms when subdivision is a known complex', () => {
    // Bradley Dr test case: 4BR, $540/mo AVM, value $282k
    const r = applyStudentHousingHeuristic({
      rentAvm: 540,
      propertyValue: 282_000,
      bedrooms: 4,
      subdivision: 'PHASE B HUNTERS RIDGE TOWNHOUSES',
    })
    expect(r.isMultiplied).toBe(true)
    expect(r.reason).toBe('subdivision-match')
    expect(r.effectiveRent).toBe(2160) // 540 × 4
    expect(r.perBedroomRent).toBe(540)
    expect(r.bedroomsUsed).toBe(4)
  })

  it('does NOT multiply when bedrooms < 3', () => {
    const r = applyStudentHousingHeuristic({
      rentAvm: 540,
      propertyValue: 282_000,
      bedrooms: 2,
      subdivision: 'HUNTERS RIDGE',
    })
    expect(r.isMultiplied).toBe(false)
  })
})

describe('applyStudentHousingHeuristic — yield anomaly', () => {
  it('multiplies when current yield is implausibly low AND multiplied yield is normal', () => {
    // $540/mo rent on $282k value = 2.3% yield (too low)
    // $2,160/mo rent × 12 / $282k = 9.2% yield (in normal range)
    const r = applyStudentHousingHeuristic({
      rentAvm: 540,
      propertyValue: 282_000,
      bedrooms: 4,
      subdivision: 'Unknown Heights', // NOT in known list
    })
    expect(r.isMultiplied).toBe(true)
    expect(r.reason).toBe('yield-anomaly')
    expect(r.effectiveRent).toBe(2160)
  })

  it('does NOT multiply when current yield is already normal', () => {
    // $2,000/mo on $282k = 8.5% — already fine
    const r = applyStudentHousingHeuristic({
      rentAvm: 2000,
      propertyValue: 282_000,
      bedrooms: 4,
      subdivision: 'Regular Subdivision',
    })
    expect(r.isMultiplied).toBe(false)
  })

  it('does NOT multiply when multiplied yield would be absurd (>15%)', () => {
    // Tiny property, low value: 1BR × $1k × 4 / $50k = 96% yield → absurd
    const r = applyStudentHousingHeuristic({
      rentAvm: 1000,
      propertyValue: 50_000,
      bedrooms: 4,
      subdivision: 'Something',
    })
    expect(r.isMultiplied).toBe(false)
  })

  it('does NOT multiply luxury low-yield markets (San Clemente case)', () => {
    // 216 W Escalones: 3BR, $2.61M, $7,070/mo = 3.25% yield (low)
    // BUT California coastal yields are structurally low, not per-bedroom.
    // Multiplied yield = 9.75% — would be "plausible" by yield math alone,
    // but the property-value + bedroom gates should block the multiplier.
    const r = applyStudentHousingHeuristic({
      rentAvm: 7070,
      propertyValue: 2_610_000,
      bedrooms: 3,
      subdivision: 'San Clemente',
    })
    expect(r.isMultiplied).toBe(false)
  })

  it('does NOT multiply high-value 4BR either (luxury, not student housing)', () => {
    // 4BR at $1.5M @ low yield is probably a luxury home, not student housing.
    // The propertyValue < $800k gate blocks this.
    const r = applyStudentHousingHeuristic({
      rentAvm: 3500,
      propertyValue: 1_500_000,
      bedrooms: 4,
      subdivision: 'Luxury Heights',
    })
    expect(r.isMultiplied).toBe(false)
  })

  it('handles zero / invalid inputs safely', () => {
    const r = applyStudentHousingHeuristic({
      rentAvm: 0,
      propertyValue: 282_000,
      bedrooms: 4,
      subdivision: 'HUNTERS RIDGE',
    })
    expect(r.isMultiplied).toBe(false)
  })
})

// --- Low-price 3BR gate (B2) ---
// Regression for Bug D: the yield-anomaly used to require bedrooms >= 4, which
// missed near-campus 3BR houses in affordable college towns — Fayetteville AR,
// Starkville MS, Bloomington IN — where Rentcast still returns per-bedroom
// rates even without a named student complex. New gate B2 opens a narrow
// 3BR + propertyValue < $300k path that cannot reach CA-coastal false positives.
describe('applyStudentHousingHeuristic — low-price 3BR (B2 gate)', () => {
  it('Fayetteville AR near-campus 3BR: $420/mo AVM on $210k → multiplies', () => {
    // 420/mo × 12 / 210k = 2.4% yield (low — per-bedroom signal)
    // 420 × 3 × 12 / 210k = 7.2% yield (normal whole-property range)
    const r = applyStudentHousingHeuristic({
      rentAvm: 420,
      propertyValue: 210_000,
      bedrooms: 3,
      subdivision: null,
    })
    expect(r.isMultiplied).toBe(true)
    expect(r.reason).toBe('yield-anomaly')
    expect(r.effectiveRent).toBe(420 * 3)
    expect(r.bedroomsUsed).toBe(3)
  })

  it('does NOT fire for 3BR at $310k (above B2 price ceiling)', () => {
    const r = applyStudentHousingHeuristic({
      rentAvm: 620,
      propertyValue: 310_000,
      bedrooms: 3,
      subdivision: null,
    })
    expect(r.isMultiplied).toBe(false)
  })

  it('San Clemente 3BR at $2.6M still blocked (CA-coastal false-positive guard)', () => {
    // Same case as the original test — must remain blocked under B2 too.
    const r = applyStudentHousingHeuristic({
      rentAvm: 7070,
      propertyValue: 2_610_000,
      bedrooms: 3,
      subdivision: 'San Clemente',
    })
    expect(r.isMultiplied).toBe(false)
  })

  it('low-price 3BR with already-normal yield does NOT fire', () => {
    // $1,400/mo × 12 / $210k = 8% → perfectly normal whole-property yield.
    const r = applyStudentHousingHeuristic({
      rentAvm: 1400,
      propertyValue: 210_000,
      bedrooms: 3,
      subdivision: null,
    })
    expect(r.isMultiplied).toBe(false)
  })
})

// Blacksburg VA regression — college-town gate (Signal C). A $540k condo at
// zip 24060 (Virginia Tech) with 3BR and a $1,700/mo AVM has a 3.8% yield —
// below the 4% threshold but ABOVE the $300k B2 cap and below the 4BR B1
// requirement. Neither B1 nor B2 fires. Signal C catches it by matching the
// zip against a curated list of known college towns.
describe('applyStudentHousingHeuristic — college-town zip (Signal C)', () => {
  it('Blacksburg VA condo (24060) near Virginia Tech: $1,700 AVM → multiplies', () => {
    const r = applyStudentHousingHeuristic({
      rentAvm: 1700,
      propertyValue: 540_000,
      bedrooms: 3,
      subdivision: null,
      zipCode: '24060',
    })
    expect(r.isMultiplied).toBe(true)
    expect(r.reason).toBe('college-town')
    expect(r.effectiveRent).toBe(1700 * 3)
    expect(r.bedroomsUsed).toBe(3)
  })

  it('does NOT fire outside a college-town zip (same yield profile)', () => {
    const r = applyStudentHousingHeuristic({
      rentAvm: 1700,
      propertyValue: 540_000,
      bedrooms: 3,
      subdivision: null,
      zipCode: '77024', // Houston, not college-town
    })
    expect(r.isMultiplied).toBe(false)
  })

  it('does NOT fire when yield is already normal even in a college zip', () => {
    // $3,000 × 12 / $540k = 6.7% → normal whole-property yield already.
    const r = applyStudentHousingHeuristic({
      rentAvm: 3000,
      propertyValue: 540_000,
      bedrooms: 3,
      subdivision: null,
      zipCode: '24060',
    })
    expect(r.isMultiplied).toBe(false)
  })

  it('does NOT fire for bedrooms < 3 even in a college zip', () => {
    const r = applyStudentHousingHeuristic({
      rentAvm: 1700,
      propertyValue: 540_000,
      bedrooms: 2,
      subdivision: null,
      zipCode: '24060',
    })
    expect(r.isMultiplied).toBe(false)
  })

  it('handles ZIP+4 by truncating to 5 digits', () => {
    const r = applyStudentHousingHeuristic({
      rentAvm: 1700,
      propertyValue: 540_000,
      bedrooms: 3,
      subdivision: null,
      zipCode: '24060-1234',
    })
    expect(r.isMultiplied).toBe(true)
  })
})

// collegeTownForZip
describe('collegeTownForZip', () => {
  it('resolves 24060 to Virginia Tech', () => {
    expect(collegeTownForZip('24060')).toContain('Virginia Tech')
  })
  it('resolves ZIP+4 (first 5 digits)', () => {
    expect(collegeTownForZip('24060-1234')).toContain('Virginia Tech')
  })
  it('returns null for non-college-town zips', () => {
    expect(collegeTownForZip('77024')).toBeNull()
    expect(collegeTownForZip('10001')).toBeNull()
  })
  it('returns null for undefined / empty', () => {
    expect(collegeTownForZip(undefined)).toBeNull()
    expect(collegeTownForZip(null)).toBeNull()
    expect(collegeTownForZip('')).toBeNull()
  })
  it('COLLEGE_TOWN_ZIPS map includes the audited zip', () => {
    expect(COLLEGE_TOWN_ZIPS['24060']).toBeDefined()
  })
})

// crossCheckRentAgainstComps — Blacksburg teaser/report mismatch regression.
// Pure helper shared between /api/preview and composeFullReport so the
// teaser and the paid report can't show different rents.
describe('crossCheckRentAgainstComps', () => {
  const multiplied = {
    effectiveRent: 5_100,
    perBedroomRent: 1_700,
    bedroomsUsed: 3,
    isMultiplied: true as const,
    reason: 'college-town' as const,
  }

  it('reverts $5,100 multiplied rent when max comp is $2,225 (Blacksburg case)', () => {
    const r = crossCheckRentAgainstComps({
      adjustment: multiplied,
      rawRentAvm: 1_700,
      rentCompRents: [1_950, 2_100, 2_225],
    })
    expect(r.revertedDueToComps).toBe(true)
    expect(r.adjustment.isMultiplied).toBe(false)
    expect(r.adjustment.effectiveRent).toBe(1_700)
    expect(r.adjustment.reason).toBeNull()
  })

  it('does NOT revert when multiplied rent is within 2× the max comp', () => {
    // max comp $3,000, multiplied $5,100 → ratio 1.7× — within 2× band.
    const r = crossCheckRentAgainstComps({
      adjustment: multiplied,
      rawRentAvm: 1_700,
      rentCompRents: [2_500, 2_800, 3_000],
    })
    expect(r.revertedDueToComps).toBe(false)
    expect(r.adjustment).toBe(multiplied)
  })

  it('does NOT revert when adjustment is not multiplied', () => {
    const notMultiplied = {
      effectiveRent: 2_000,
      perBedroomRent: null,
      bedroomsUsed: null,
      isMultiplied: false as const,
      reason: null,
    }
    const r = crossCheckRentAgainstComps({
      adjustment: notMultiplied,
      rawRentAvm: 2_000,
      rentCompRents: [500], // absurdly low comp — still no revert (nothing was multiplied)
    })
    expect(r.revertedDueToComps).toBe(false)
  })

  it('does NOT revert when rent comps are empty', () => {
    const r = crossCheckRentAgainstComps({
      adjustment: multiplied,
      rawRentAvm: 1_700,
      rentCompRents: [],
    })
    expect(r.revertedDueToComps).toBe(false)
  })

  it('filters non-finite / non-positive rents before computing max', () => {
    const r = crossCheckRentAgainstComps({
      adjustment: multiplied,
      rawRentAvm: 1_700,
      rentCompRents: [NaN, 0, -100, 1_950, 2_225],
    })
    // max filtered = 2,225; 5,100 > 4,450 → revert
    expect(r.revertedDueToComps).toBe(true)
  })

  it('exactly 2× the max comp does NOT revert (boundary)', () => {
    const r = crossCheckRentAgainstComps({
      adjustment: { ...multiplied, effectiveRent: 4_450 },
      rawRentAvm: 1_700,
      rentCompRents: [2_000, 2_100, 2_225],
    })
    // 4,450 === 2× 2,225 → not strictly greater → keep
    expect(r.revertedDueToComps).toBe(false)
  })
})
