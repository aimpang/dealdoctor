import { describe, expect, it } from 'vitest'
import { applyStoredListingPriceResolution } from './reportGenerator'

describe('applyStoredListingPriceResolution', () => {
  it('reuses the stored resolved listing price instead of the freshly fetched provider price', () => {
    const hydratedProperty = applyStoredListingPriceResolution(
      {
        property_id: 'prop-1',
        address: '3000 Oasis Grand Blvd Apt 2502, Fort Myers, FL 33916',
        city: 'Fort Myers',
        state: 'FL',
        zip_code: '33916',
        bedrooms: 2,
        bathrooms: 2,
        property_type: 'Condo',
        estimated_value: 295_000,
        primary_listing_price: 295_000,
        listing_price: 295_000,
        listing_price_source: 'primary',
        listing_price_status: 'resolved',
        listing_price_checked_at: '2026-04-16T12:00:00.000Z',
        listing_price_user_supplied: false,
        year_built: 2008,
        square_feet: 1319,
      },
      JSON.stringify({
        listingPrice: 275_000,
        listingPriceSource: 'user-confirmed',
        listingPriceStatus: 'resolved',
        listingPriceCheckedAt: '2026-04-16T12:05:00.000Z',
        listingPriceUserSupplied: true,
        primaryListingPrice: 295_000,
        fallbackListingPrice: 275_000,
      })
    )

    expect(hydratedProperty.listing_price).toBe(275_000)
    expect(hydratedProperty.listing_price_source).toBe('user-confirmed')
    expect(hydratedProperty.listing_price_status).toBe('resolved')
    expect(hydratedProperty.listing_price_checked_at).toBe('2026-04-16T12:05:00.000Z')
    expect(hydratedProperty.listing_price_user_supplied).toBe(true)
    expect(hydratedProperty.primary_listing_price).toBe(295_000)
    expect(hydratedProperty.fallback_listing_price).toBe(275_000)
  })
})
