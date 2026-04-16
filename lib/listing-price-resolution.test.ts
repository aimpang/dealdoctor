import { describe, expect, it } from 'vitest'
import {
  buildListingPriceResolutionMessage,
  hasResolvedListingPrice,
  isListingPriceCheckStale,
  isManualListingPriceConfirmationStale,
  parseListingPriceResolution,
  resolveListingPriceResolution,
} from './listing-price-resolution'

describe('resolveListingPriceResolution', () => {
  it('uses the primary listing price when it is the only valid source', () => {
    const resolution = resolveListingPriceResolution({
      primaryListingPrice: 275_000,
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
    })

    expect(resolution).toEqual({
      listingPrice: 275_000,
      listingPriceSource: 'primary',
      listingPriceStatus: 'resolved',
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
      listingPriceUserSupplied: false,
      primaryListingPrice: 275_000,
      fallbackListingPrice: undefined,
    })
  })

  it('uses the fallback listing price when the primary source is missing', () => {
    const resolution = resolveListingPriceResolution({
      fallbackListingPrice: 275_000,
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
    })

    expect(resolution).toEqual({
      listingPrice: 275_000,
      listingPriceSource: 'fallback',
      listingPriceStatus: 'resolved',
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
      listingPriceUserSupplied: false,
      primaryListingPrice: undefined,
      fallbackListingPrice: 275_000,
    })
  })

  it('prefers the primary source when the two prices agree within tolerance', () => {
    const resolution = resolveListingPriceResolution({
      primaryListingPrice: 295_000,
      fallbackListingPrice: 292_000,
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
    })

    expect(resolution).toEqual({
      listingPrice: 295_000,
      listingPriceSource: 'primary',
      listingPriceStatus: 'resolved',
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
      listingPriceUserSupplied: false,
      primaryListingPrice: 295_000,
      fallbackListingPrice: 292_000,
    })
  })

  it('marks the listing price as conflicted when sources diverge materially', () => {
    const resolution = resolveListingPriceResolution({
      primaryListingPrice: 295_000,
      fallbackListingPrice: 275_000,
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
    })

    expect(resolution).toEqual({
      listingPrice: undefined,
      listingPriceSource: undefined,
      listingPriceStatus: 'conflicted',
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
      listingPriceUserSupplied: false,
      primaryListingPrice: 295_000,
      fallbackListingPrice: 275_000,
    })
  })

  it('accepts a user-confirmed listing price as authoritative', () => {
    const resolution = resolveListingPriceResolution({
      primaryListingPrice: 295_000,
      fallbackListingPrice: 275_000,
      confirmedListingPrice: 275_000,
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
    })

    expect(resolution).toEqual({
      listingPrice: 275_000,
      listingPriceSource: 'user-confirmed',
      listingPriceStatus: 'resolved',
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
      listingPriceUserSupplied: true,
      primaryListingPrice: 295_000,
      fallbackListingPrice: 275_000,
    })
  })

  it('returns missing when no source can resolve the ask', () => {
    const resolution = resolveListingPriceResolution({
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
    })

    expect(resolution).toEqual({
      listingPrice: undefined,
      listingPriceSource: undefined,
      listingPriceStatus: 'missing',
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
      listingPriceUserSupplied: false,
      primaryListingPrice: undefined,
      fallbackListingPrice: undefined,
    })
  })
})

describe('parseListingPriceResolution', () => {
  it('reads persisted teaser data for resolved prices', () => {
    const resolution = parseListingPriceResolution(
      JSON.stringify({
        listingPrice: 275_000,
        listingPriceSource: 'user-confirmed',
        listingPriceStatus: 'resolved',
        listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
        listingPriceUserSupplied: true,
        primaryListingPrice: 295_000,
        fallbackListingPrice: 275_000,
      })
    )

    expect(resolution).toEqual({
      listingPrice: 275_000,
      listingPriceSource: 'user-confirmed',
      listingPriceStatus: 'resolved',
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
      listingPriceUserSupplied: true,
      primaryListingPrice: 295_000,
      fallbackListingPrice: 275_000,
    })
  })

  it('returns null when the payload has no listing-price state', () => {
    expect(parseListingPriceResolution(JSON.stringify({ estimatedValue: 295_000 }))).toBeNull()
  })
})

describe('listing-price helper guards', () => {
  it('recognizes resolved prices', () => {
    expect(
      hasResolvedListingPrice(
        resolveListingPriceResolution({ primaryListingPrice: 275_000 })
      )
    ).toBe(true)
  })

  it('recognizes unresolved states', () => {
    expect(
      hasResolvedListingPrice(
        resolveListingPriceResolution({
          primaryListingPrice: 295_000,
          fallbackListingPrice: 275_000,
        })
      )
    ).toBe(false)
  })

  it('produces a conflict prompt message with both source values', () => {
    const resolution = resolveListingPriceResolution({
      primaryListingPrice: 295_000,
      fallbackListingPrice: 275_000,
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
    })

    expect(buildListingPriceResolutionMessage(resolution)).toContain('$295,000')
    expect(buildListingPriceResolutionMessage(resolution)).toContain('$275,000')
  })

  it('marks old manual confirmations as stale', () => {
    const resolution = resolveListingPriceResolution({
      confirmedListingPrice: 275_000,
      listingPriceCheckedAt: '2026-04-14T12:00:00.000Z',
    })

    expect(
      isManualListingPriceConfirmationStale(
        resolution,
        Date.parse('2026-04-16T13:00:00.000Z')
      )
    ).toBe(true)
  })

  it('treats recent listing checks as fresh', () => {
    expect(
      isListingPriceCheckStale(
        '2026-04-16T12:00:00.000Z',
        Date.parse('2026-04-16T18:00:00.000Z')
      )
    ).toBe(false)
  })
})
