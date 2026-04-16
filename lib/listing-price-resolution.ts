import { logger } from './logger'

export interface ListingPriceResolutionInput {
  primaryListingPrice?: number | null
  fallbackListingPrice?: number | null
  confirmedListingPrice?: number | null
  listingPriceCheckedAt?: string | null
}

export interface ListingPriceResolution {
  listingPrice?: number
  listingPriceSource?: 'primary' | 'fallback' | 'user-confirmed'
  listingPriceStatus: 'resolved' | 'missing' | 'conflicted'
  listingPriceCheckedAt: string
  listingPriceUserSupplied: boolean
  primaryListingPrice?: number
  fallbackListingPrice?: number
}

export interface FallbackListingPriceResult {
  listingPrice?: number
  checkedAt?: string
}

export interface ListingPriceSnapshotContainer {
  listingPrice?: unknown
  listingPriceSource?: unknown
  listingPriceStatus?: unknown
  listingPriceCheckedAt?: unknown
  listingPriceUserSupplied?: unknown
  primaryListingPrice?: unknown
  fallbackListingPrice?: unknown
}

const LISTING_PRICE_CONFLICT_PERCENT_THRESHOLD = 0.05
const LISTING_PRICE_CONFLICT_AMOUNT_THRESHOLD_USD = 10_000
const MANUAL_LISTING_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const LISTING_PRICE_FALLBACK_URL = process.env.LISTING_PRICE_FALLBACK_URL?.trim() || ''
const LISTING_PRICE_FALLBACK_API_KEY = process.env.LISTING_PRICE_FALLBACK_API_KEY?.trim() || ''
const LISTING_PRICE_FALLBACK_HEADER_NAME =
  process.env.LISTING_PRICE_FALLBACK_HEADER_NAME?.trim() || 'X-Api-Key'

const toPositiveListingPrice = (value: unknown): number | undefined => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : undefined
}

const toObjectRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  return value as Record<string, unknown>
}

const pickString = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

export const hasMaterialListingPriceConflict = (
  primaryListingPrice: number,
  fallbackListingPrice: number
): boolean => {
  const absoluteDifferenceUsd = Math.abs(primaryListingPrice - fallbackListingPrice)
  const percentageDifference =
    absoluteDifferenceUsd / Math.max(Math.min(primaryListingPrice, fallbackListingPrice), 1)

  return (
    absoluteDifferenceUsd > LISTING_PRICE_CONFLICT_AMOUNT_THRESHOLD_USD ||
    percentageDifference > LISTING_PRICE_CONFLICT_PERCENT_THRESHOLD
  )
}

export const isListingPriceCheckStale = (
  listingPriceCheckedAt?: string | null,
  nowMs: number = Date.now()
): boolean => {
  const checkedAt = pickString(listingPriceCheckedAt)
  if (!checkedAt) {
    return true
  }

  const checkedAtMs = Date.parse(checkedAt)
  if (!Number.isFinite(checkedAtMs)) {
    return true
  }

  return nowMs - checkedAtMs > MANUAL_LISTING_PRICE_MAX_AGE_MS
}

export const isManualListingPriceConfirmationStale = (
  resolution: ListingPriceResolution | null | undefined,
  nowMs: number = Date.now()
): boolean => {
  return Boolean(
    resolution?.listingPriceUserSupplied &&
      isListingPriceCheckStale(resolution.listingPriceCheckedAt, nowMs)
  )
}

const getResolutionCheckedAt = (listingPriceCheckedAt?: string | null): string => {
  const checkedAt = pickString(listingPriceCheckedAt)
  return checkedAt ?? new Date().toISOString()
}

const extractFallbackListingPrice = (payload: Record<string, unknown> | null): number | undefined => {
  if (!payload) {
    return undefined
  }

  const directListingPrice =
    toPositiveListingPrice(payload.listingPrice) ??
    toPositiveListingPrice(payload.listing_price) ??
    toPositiveListingPrice(payload.price)
  if (directListingPrice) {
    return directListingPrice
  }

  const nestedData = toObjectRecord(payload.data)
  if (!nestedData) {
    return undefined
  }

  return (
    toPositiveListingPrice(nestedData.listingPrice) ??
    toPositiveListingPrice(nestedData.listing_price) ??
    toPositiveListingPrice(nestedData.price)
  )
}

const extractFallbackCheckedAt = (payload: Record<string, unknown> | null): string | undefined => {
  if (!payload) {
    return undefined
  }

  const directCheckedAt =
    pickString(payload.checkedAt) ??
    pickString(payload.checked_at) ??
    pickString(payload.updatedAt) ??
    pickString(payload.updated_at)
  if (directCheckedAt) {
    return directCheckedAt
  }

  const nestedData = toObjectRecord(payload.data)
  if (!nestedData) {
    return undefined
  }

  return (
    pickString(nestedData.checkedAt) ??
    pickString(nestedData.checked_at) ??
    pickString(nestedData.updatedAt) ??
    pickString(nestedData.updated_at)
  )
}

export const resolveListingPriceResolution = (
  input: ListingPriceResolutionInput
): ListingPriceResolution => {
  const primaryListingPrice = toPositiveListingPrice(input.primaryListingPrice)
  const fallbackListingPrice = toPositiveListingPrice(input.fallbackListingPrice)
  const confirmedListingPrice = toPositiveListingPrice(input.confirmedListingPrice)
  const listingPriceCheckedAt = getResolutionCheckedAt(input.listingPriceCheckedAt)

  if (confirmedListingPrice) {
    return {
      listingPrice: confirmedListingPrice,
      listingPriceSource: 'user-confirmed',
      listingPriceStatus: 'resolved',
      listingPriceCheckedAt,
      listingPriceUserSupplied: true,
      primaryListingPrice,
      fallbackListingPrice,
    }
  }

  if (primaryListingPrice && fallbackListingPrice) {
    if (hasMaterialListingPriceConflict(primaryListingPrice, fallbackListingPrice)) {
      return {
        listingPriceStatus: 'conflicted',
        listingPriceCheckedAt,
        listingPriceUserSupplied: false,
        primaryListingPrice,
        fallbackListingPrice,
      }
    }

    return {
      listingPrice: primaryListingPrice,
      listingPriceSource: 'primary',
      listingPriceStatus: 'resolved',
      listingPriceCheckedAt,
      listingPriceUserSupplied: false,
      primaryListingPrice,
      fallbackListingPrice,
    }
  }

  if (primaryListingPrice) {
    return {
      listingPrice: primaryListingPrice,
      listingPriceSource: 'primary',
      listingPriceStatus: 'resolved',
      listingPriceCheckedAt,
      listingPriceUserSupplied: false,
      primaryListingPrice,
      fallbackListingPrice,
    }
  }

  if (fallbackListingPrice) {
    return {
      listingPrice: fallbackListingPrice,
      listingPriceSource: 'fallback',
      listingPriceStatus: 'resolved',
      listingPriceCheckedAt,
      listingPriceUserSupplied: false,
      primaryListingPrice,
      fallbackListingPrice,
    }
  }

  return {
    listingPriceStatus: 'missing',
    listingPriceCheckedAt,
    listingPriceUserSupplied: false,
    primaryListingPrice,
    fallbackListingPrice,
  }
}

export const hasResolvedListingPrice = (
  resolution: ListingPriceResolution | null | undefined
): resolution is ListingPriceResolution & {
  listingPrice: number
  listingPriceStatus: 'resolved'
} => {
  return Boolean(
    resolution?.listingPriceStatus === 'resolved' &&
      typeof resolution?.listingPrice === 'number' &&
      resolution.listingPrice > 0
  )
}

export const buildListingPriceResolutionMessage = (
  resolution: ListingPriceResolution
): string => {
  if (resolution.listingPriceStatus === 'conflicted') {
    const primaryListingPrice = resolution.primaryListingPrice?.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    })
    const fallbackListingPrice = resolution.fallbackListingPrice?.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    })

    return `We found conflicting listing prices for this property. Primary source: ${primaryListingPrice}. Fallback source: ${fallbackListingPrice}. Enter the current ask price from the live listing to continue.`
  }

  return "We couldn't verify the current listing price automatically. Enter the current ask price from the live listing to continue."
}

export const parseListingPriceResolution = (
  container: unknown
): ListingPriceResolution | null => {
  let parsedContainer: unknown = container

  if (typeof container === 'string') {
    try {
      parsedContainer = JSON.parse(container)
    } catch {
      return null
    }
  }

  const record = toObjectRecord(parsedContainer) as ListingPriceSnapshotContainer | null
  if (!record) {
    return null
  }

  const primaryListingPrice = toPositiveListingPrice(record.primaryListingPrice)
  const fallbackListingPrice = toPositiveListingPrice(record.fallbackListingPrice)
  const listingPrice = toPositiveListingPrice(record.listingPrice)
  const listingPriceSource =
    record.listingPriceSource === 'primary' ||
    record.listingPriceSource === 'fallback' ||
    record.listingPriceSource === 'user-confirmed'
      ? record.listingPriceSource
      : listingPrice
        ? 'primary'
        : undefined
  const listingPriceStatus =
    record.listingPriceStatus === 'resolved' ||
    record.listingPriceStatus === 'missing' ||
    record.listingPriceStatus === 'conflicted'
      ? record.listingPriceStatus
      : listingPrice
        ? 'resolved'
        : undefined
  const listingPriceCheckedAt = getResolutionCheckedAt(
    pickString(record.listingPriceCheckedAt)
  )
  const listingPriceUserSupplied =
    typeof record.listingPriceUserSupplied === 'boolean'
      ? record.listingPriceUserSupplied
      : listingPriceSource === 'user-confirmed'

  if (
    !listingPrice &&
    !primaryListingPrice &&
    !fallbackListingPrice &&
    !listingPriceStatus
  ) {
    return null
  }

  return {
    listingPrice,
    listingPriceSource,
    listingPriceStatus: listingPriceStatus ?? 'missing',
    listingPriceCheckedAt,
    listingPriceUserSupplied,
    primaryListingPrice,
    fallbackListingPrice,
  }
}

export const fetchFallbackListingPrice = async (
  address: string
): Promise<FallbackListingPriceResult | null> => {
  if (!LISTING_PRICE_FALLBACK_URL) {
    return null
  }

  try {
    const fallbackUrl = new URL(LISTING_PRICE_FALLBACK_URL)
    fallbackUrl.searchParams.set('address', address)

    const fallbackHeaders: HeadersInit = {}
    if (LISTING_PRICE_FALLBACK_API_KEY) {
      fallbackHeaders[LISTING_PRICE_FALLBACK_HEADER_NAME] = LISTING_PRICE_FALLBACK_API_KEY
    }

    const response = await fetch(fallbackUrl.toString(), {
      headers: fallbackHeaders,
      next: { revalidate: 86_400 },
    })

    if (!response.ok) {
      logger.warn('listing_price_fallback.request_failed', {
        address,
        status: response.status,
      })
      return null
    }

    const payload = toObjectRecord(await response.json())
    const listingPrice = extractFallbackListingPrice(payload)
    if (!listingPrice) {
      return null
    }

    return {
      listingPrice,
      checkedAt: extractFallbackCheckedAt(payload) ?? new Date().toISOString(),
    }
  } catch (error) {
    logger.warn('listing_price_fallback.error', { address, error })
    return null
  }
}
