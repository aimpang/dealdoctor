import { describe, it, expect } from 'vitest'
import {
  matchesKnownStudentComplex,
  applyStudentHousingHeuristic,
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
