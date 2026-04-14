import { describe, it, expect } from 'vitest'
import {
  buildPropertyDataFromAvm,
  classifyAddressMatch,
  parseAddressParts,
  buildingKey,
  isUnitLikeAddress,
} from './propertyApi'
// NOTE: the commercial-comp and duplicate-comp filters live inside
// getComparableSales (network) and are covered via the scenario replay
// suite. These tests focus on the pure helpers.

// Regression for the Blacksburg VA lookup failure. Rentcast's /properties
// endpoint 404s on addresses it doesn't have in its property database, even
// when the AVM endpoint has full coverage (price + range + comparables).
// Previously that produced a "Property not found" error; now we synthesize
// a PropertyData from the AVM subject + comparable-median bed/bath/sqft/etc.
describe('buildPropertyDataFromAvm', () => {
  const avm = {
    price: 540_000,
    low: 293_000,
    high: 787_000,
    subject: {
      address: '412 N Main St, Blacksburg, VA 24060',
      city: 'Blacksburg',
      state: 'VA',
      zipCode: '24060',
      latitude: 37.231832,
      longitude: -80.416109,
    },
    comparables: [
      { bedrooms: 3, bathrooms: 2.5, squareFootage: 1700, propertyType: 'Single Family', yearBuilt: 2005 },
      { bedrooms: 4, bathrooms: 3, squareFootage: 1900, propertyType: 'Single Family', yearBuilt: 2000 },
      { bedrooms: 3, bathrooms: 2, squareFootage: 1600, propertyType: 'Single Family', yearBuilt: 1998 },
    ],
  }

  it('builds a valid PropertyData from AVM subject + comparables', () => {
    const p = buildPropertyDataFromAvm('412 N Main St, Blacksburg, VA 24060', avm)
    expect(p).not.toBeNull()
    expect(p!.address).toBe('412 N Main St, Blacksburg, VA 24060')
    expect(p!.city).toBe('Blacksburg')
    expect(p!.state).toBe('VA')
    expect(p!.zip_code).toBe('24060')
    expect(p!.estimated_value).toBe(540_000)
    expect(p!.value_range_low).toBe(293_000)
    expect(p!.value_range_high).toBe(787_000)
    expect(p!.value_source).toBe('avm')
    expect(p!.latitude).toBeCloseTo(37.231832, 3)
    expect(p!.longitude).toBeCloseTo(-80.416109, 3)
  })

  it('tags data_completeness as "avm-only"', () => {
    const p = buildPropertyDataFromAvm('anywhere', avm)
    expect(p!.data_completeness).toBe('avm-only')
  })

  it('uses median comparable bed/bath/sqft/yearBuilt', () => {
    // median bedrooms [3,3,4] = 3, median bathrooms [2,2.5,3] = 2.5,
    // median sqft [1600,1700,1900] = 1700, median yearBuilt [1998,2000,2005] = 2000
    const p = buildPropertyDataFromAvm('x', avm)
    expect(p!.bedrooms).toBe(3)
    expect(p!.bathrooms).toBe(2.5)
    expect(p!.square_feet).toBe(1700)
    expect(p!.year_built).toBe(2000)
    expect(p!.property_type).toBe('Single Family')
  })

  it('returns null when AVM has no subject (can\'t build address)', () => {
    expect(buildPropertyDataFromAvm('x', { ...avm, subject: undefined })).toBeNull()
  })

  it('returns null when AVM has no price', () => {
    expect(buildPropertyDataFromAvm('x', { ...avm, price: 0 })).toBeNull()
  })

  it('falls back to safe defaults when comparables are empty', () => {
    const p = buildPropertyDataFromAvm('x', { ...avm, comparables: [] })
    expect(p).not.toBeNull()
    // Defaults: 3bd / 2ba / 1500 sqft / built 1970 / Single Family
    expect(p!.bedrooms).toBe(3)
    expect(p!.bathrooms).toBe(2)
    expect(p!.square_feet).toBe(1500)
    expect(p!.year_built).toBe(1970)
    expect(p!.property_type).toBe('Single Family')
  })

  it('picks the modal propertyType across mixed comparables', () => {
    const mixedComps = [
      { bedrooms: 3, bathrooms: 2, squareFootage: 1500, propertyType: 'Single Family', yearBuilt: 2000 },
      { bedrooms: 2, bathrooms: 2, squareFootage: 1200, propertyType: 'Condo', yearBuilt: 2010 },
      { bedrooms: 3, bathrooms: 2, squareFootage: 1600, propertyType: 'Condo', yearBuilt: 2008 },
      { bedrooms: 2, bathrooms: 1, squareFootage: 1100, propertyType: 'Condo', yearBuilt: 2005 },
    ]
    const p = buildPropertyDataFromAvm('x', { ...avm, comparables: mixedComps })
    expect(p!.property_type).toBe('Condo')
  })

  it('rounds bathrooms to the nearest 0.5', () => {
    const odd = [
      { bedrooms: 3, bathrooms: 2.3, squareFootage: 1500, propertyType: 'SFR' },
      { bedrooms: 3, bathrooms: 2.8, squareFootage: 1500, propertyType: 'SFR' },
      { bedrooms: 3, bathrooms: 3.1, squareFootage: 1500, propertyType: 'SFR' },
    ]
    const p = buildPropertyDataFromAvm('x', { ...avm, comparables: odd })
    // Median of 2.3/2.8/3.1 = 2.8 → rounded to nearest 0.5 = 3.0
    expect(p!.bathrooms).toBe(3.0)
  })

  it('filters zero/invalid values from comparable medians', () => {
    const bad = [
      { bedrooms: 0, bathrooms: 0, squareFootage: 0, propertyType: 'SFR', yearBuilt: 0 },
      { bedrooms: 3, bathrooms: 2, squareFootage: 1500, propertyType: 'SFR', yearBuilt: 2000 },
      { bedrooms: 3, bathrooms: 2, squareFootage: 1500, propertyType: 'SFR', yearBuilt: 2000 },
    ]
    const p = buildPropertyDataFromAvm('x', { ...avm, comparables: bad })
    expect(p!.bedrooms).toBe(3)
    expect(p!.bathrooms).toBe(2)
    expect(p!.square_feet).toBe(1500)
    expect(p!.year_built).toBe(2000)
  })
})

// Saginaw MI regression — Rentcast silently substituted "408 N 8th St" for
// the user-typed "408 S 8th St" (different property). The classifier now
// spots these and the preview route blocks until the user confirms.
describe('classifyAddressMatch', () => {
  it('hard-mismatch when cardinal direction flips (Saginaw case)', () => {
    const r = classifyAddressMatch(
      '408 S 8th St, Saginaw, MI 48601',
      '408 N 8th St, Saginaw, MI 48601'
    )
    expect(r.kind).toBe('hard-mismatch')
    expect(r.mismatches).toContain('direction')
  })

  it('hard-mismatch when street number differs', () => {
    const r = classifyAddressMatch(
      '408 S 8th St, Saginaw, MI',
      '410 S 8th St, Saginaw, MI'
    )
    expect(r.kind).toBe('hard-mismatch')
    expect(r.mismatches).toContain('number')
  })

  it('hard-mismatch when street name is different', () => {
    const r = classifyAddressMatch(
      '408 S 8th St, Saginaw, MI',
      '408 S Main St, Saginaw, MI'
    )
    expect(r.kind).toBe('hard-mismatch')
    expect(r.mismatches).toContain('streetName')
  })

  it('hard-mismatch when zip differs', () => {
    const r = classifyAddressMatch(
      '408 S 8th St, Saginaw, MI 48601',
      '408 S 8th St, Saginaw, MI 48602'
    )
    expect(r.kind).toBe('hard-mismatch')
    expect(r.mismatches).toContain('zip')
  })

  it('exact when addresses match', () => {
    expect(
      classifyAddressMatch(
        '412 N Main St, Blacksburg, VA 24060',
        '412 N Main St, Blacksburg, VA 24060'
      ).kind
    ).toBe('exact')
  })

  it('exact when suffix spelling differs but normalizes equal (St vs Street)', () => {
    expect(
      classifyAddressMatch(
        '412 N Main Street, Blacksburg, VA 24060',
        '412 N Main St, Blacksburg, VA 24060'
      ).kind
    ).toBe('exact')
  })

  it('soft when user omitted direction and Rentcast added one', () => {
    // User typed no direction; Rentcast resolved with "N". We treat this as
    // soft (they probably meant N), not hard. If they meant S they can
    // retype with the direction included.
    expect(
      classifyAddressMatch(
        '412 Main St, Blacksburg, VA 24060',
        '412 N Main St, Blacksburg, VA 24060'
      ).kind
    ).not.toBe('hard-mismatch')
  })

  it('exact when user typed full direction word ("North" vs "N")', () => {
    expect(
      classifyAddressMatch(
        '412 North Main St, Blacksburg, VA 24060',
        '412 N Main St, Blacksburg, VA 24060'
      ).kind
    ).toBe('exact')
  })

  it('case-insensitive', () => {
    expect(
      classifyAddressMatch(
        '412 n MAIN st, BLACKSBURG, va 24060',
        '412 N Main St, Blacksburg, VA 24060'
      ).kind
    ).toBe('exact')
  })
})

describe('parseAddressParts', () => {
  it('parses a standard US address', () => {
    const p = parseAddressParts('412 N Main St, Blacksburg, VA 24060')
    expect(p.number).toBe('412')
    expect(p.direction).toBe('n')
    expect(p.streetCore).toContain('main')
    expect(p.streetSuffix).toBe('st')
    expect(p.city).toBe('blacksburg')
    expect(p.state).toBe('va')
    expect(p.zip).toBe('24060')
  })

  it('normalizes suffix spellings', () => {
    expect(parseAddressParts('100 Main Street, X, VA 10000').streetSuffix).toBe('st')
    expect(parseAddressParts('100 Main Avenue, X, VA 10000').streetSuffix).toBe('ave')
    expect(parseAddressParts('100 Main Road, X, VA 10000').streetSuffix).toBe('rd')
  })

  it('normalizes direction spellings', () => {
    expect(parseAddressParts('100 North Main St').direction).toBe('n')
    expect(parseAddressParts('100 South Main St').direction).toBe('s')
    expect(parseAddressParts('100 NW Main St').direction).toBe('nw')
  })
})

// The Apolline DC regression — buildingKey lets us identify same-building
// comp matches so a condo subject prefers its own units over neighborhood
// matches 0.7 mi away. Pure function, unit-addressable regardless of API.
describe('buildingKey', () => {
  it('produces a canonical key for a condo address', () => {
    const k = buildingKey('1330 New Hampshire Ave NW, Washington, DC 20036')
    // number + direction + street-core tokens (suffix dropped)
    expect(k).toBe('1330 nw new hampshire')
  })

  it('matches unit-level addresses in the same building', () => {
    const a = buildingKey('1330 New Hampshire Ave NW, Apt 516, Washington, DC 20036')
    const b = buildingKey('1330 New Hampshire Ave NW, Apt 620, Washington, DC 20036')
    const c = buildingKey('1330 New Hampshire Ave NW #1002, Washington, DC 20036')
    expect(a).toBe(b)
    expect(a).toBe(c)
  })

  it('differentiates different buildings on the same street', () => {
    const apolline = buildingKey('1330 New Hampshire Ave NW, Washington, DC')
    const other = buildingKey('1101 L St NW, Washington, DC')
    expect(apolline).not.toBe(other)
  })

  it('is case-insensitive', () => {
    expect(buildingKey('1330 NEW HAMPSHIRE AVE NW, WASHINGTON, DC'))
      .toBe(buildingKey('1330 new hampshire ave nw, washington, dc'))
  })

  it('returns null for addresses without a number', () => {
    expect(buildingKey('New Hampshire Ave NW, Washington, DC')).toBeNull()
  })

  it('returns null for empty / garbage input', () => {
    expect(buildingKey('')).toBeNull()
    expect(buildingKey('---')).toBeNull()
  })
})

// Regression: Baltimore 414 Water St #1501 audit. Rentcast's propertyType
// field was returning blank for a specific unit, bypassing the condo zip
// guard and re-admitting 21230 Ridgley's Delight comps on a 21202 condo.
// isUnitLikeAddress is the secondary signal that keeps the filter honest
// when the API payload is ambiguous.
describe('isUnitLikeAddress', () => {
  it('detects hash unit marker', () => {
    expect(isUnitLikeAddress('414 Water St #1501, Baltimore, MD 21202')).toBe(true)
  })
  it('detects Apt marker', () => {
    expect(isUnitLikeAddress('1300 Main St Apt 4B, Anytown, NY 10001')).toBe(true)
  })
  it('detects Unit marker', () => {
    expect(isUnitLikeAddress('500 Elm St Unit 201, Anytown, NY 10001')).toBe(true)
  })
  it('detects Suite marker', () => {
    expect(isUnitLikeAddress('700 Oak Ave Suite 5, Anytown, NY 10001')).toBe(true)
  })
  it('does not false-positive on SFR address', () => {
    expect(isUnitLikeAddress('657 Washington Blvd, Baltimore, MD 21230')).toBe(false)
  })
  it('does not false-positive on empty input', () => {
    expect(isUnitLikeAddress('')).toBe(false)
  })
})
