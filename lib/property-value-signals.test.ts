import { describe, expect, it } from 'vitest'
import {
  resolveListingPrice,
  resolvePropertyValueSignals,
} from './property-value-signals'

describe('resolvePropertyValueSignals', () => {
  it('keeps listing price separate when an AVM is available', () => {
    const output = resolvePropertyValueSignals({
      listingPrice: 275_000,
      avmPrice: 295_000,
      avmLow: 259_000,
      avmHigh: 331_000,
    })

    expect(output).toEqual({
      estimatedValue: 295_000,
      listingPrice: 275_000,
      valueSource: 'avm',
      valueRangeLow: 259_000,
      valueRangeHigh: 331_000,
    })
  })

  it('falls back to listing price when no AVM exists', () => {
    const output = resolvePropertyValueSignals({
      listingPrice: 275_000,
    })

    expect(output).toEqual({
      estimatedValue: 275_000,
      listingPrice: 275_000,
      valueSource: 'listing',
    })
  })

  it('falls back to tax assessment before last-sale growth when listing and AVM are missing', () => {
    const output = resolvePropertyValueSignals({
      taxAssessmentValues: [null, 240_000, 230_000],
      lastSalePrice: 200_000,
      lastSaleDate: '2022-01-01',
      currentDate: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(output).toEqual({
      estimatedValue: 276_000,
      listingPrice: undefined,
      valueSource: 'tax-assessment',
    })
  })
})

describe('resolveListingPrice', () => {
  it('prefers listing price for deal math when present', () => {
    expect(
      resolveListingPrice({
        listing_price: 275_000,
        estimated_value: 295_000,
      })
    ).toBe(275_000)
  })

  it('falls back to estimated value when listing price is unavailable', () => {
    expect(
      resolveListingPrice({
        estimated_value: 295_000,
      })
    ).toBe(295_000)
  })
})
