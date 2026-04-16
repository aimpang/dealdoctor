import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRateLimit = vi.fn()
const mockGetClientIp = vi.fn()
const mockSearchProperty = vi.fn()
const mockGetCurrentRates = vi.fn()
const mockGetRentEstimate = vi.fn()
const mockPrismaReportFindFirst = vi.fn()
const mockPrismaReportCreate = vi.fn()
const mockPrismaReportFindUnique = vi.fn()
const mockCreateCheckout = vi.fn()
const mockLemonSqueezySetup = vi.fn()
const mockGetCurrentCustomer = vi.fn()
const mockGenerateFullReport = vi.fn()

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: mockRateLimit,
}))

vi.mock('@/lib/clientIp', () => ({
  getClientIp: mockGetClientIp,
}))

vi.mock('@/lib/propertyApi', () => ({
  searchProperty: mockSearchProperty,
  getRentEstimate: mockGetRentEstimate,
  getRentComps: vi.fn(),
  RentcastQuotaError: class RentcastQuotaError extends Error {
    status: number

    constructor(status: number) {
      super(`Rentcast API ${status}`)
      this.status = status
    }
  },
  classifyAddressMatch: vi.fn(() => ({ kind: 'exact', mismatches: [] })),
  isUnitLikeAddress: vi.fn(() => false),
}))

vi.mock('@/lib/rates', () => ({
  getCurrentRates: mockGetCurrentRates,
  applyInvestorPremium: vi.fn((rate: number) => rate + 0.0075),
}))

vi.mock('@/lib/studentHousing', () => ({
  applyStudentHousingHeuristic: vi.fn(({ rentAvm }: { rentAvm: number }) => ({
    effectiveRent: rentAvm,
    isMultiplied: false,
    bedroomsUsed: null,
    reason: null,
    perBedroomRent: null,
  })),
  collegeTownForZip: vi.fn(() => null),
  crossCheckRentAgainstComps: vi.fn(
    ({ adjustment }: { adjustment: unknown }) => ({
      adjustment,
      revertedDueToComps: false,
    })
  ),
}))

vi.mock('@/lib/buildingHoa', () => ({
  lookupBuildingHoa: vi.fn(() => null),
}))

vi.mock('@/lib/qualityAudit', () => ({
  buildPropertyProfileAudit: vi.fn(() => ({ status: 'ok', hardFailures: [] })),
  isUnsupportedPropertyType: vi.fn(() => false),
}))

vi.mock('@/lib/entitlements', () => ({
  getCurrentCustomer: mockGetCurrentCustomer,
  hasActiveEntitlement: vi.fn(() => ({ active: false })),
  enforceEntitlementExpiry: vi.fn((customer: unknown) => customer),
  debitForNewReport: vi.fn(() => ({ debited: false })),
}))

vi.mock('@/lib/reportGenerator', () => ({
  generateFullReport: mockGenerateFullReport,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    report: {
      findFirst: mockPrismaReportFindFirst,
      create: mockPrismaReportCreate,
      findUnique: mockPrismaReportFindUnique,
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('@lemonsqueezy/lemonsqueezy.js', () => ({
  lemonSqueezySetup: mockLemonSqueezySetup,
  createCheckout: mockCreateCheckout,
}))

vi.mock('@/lib/seo', () => ({
  absoluteUrl: (path: string) => `https://dealdoctor.us${path}`,
}))

const baseAddress = '123 Main St, Austin, TX 78701'

const createRequest = (pathname: string, body: Record<string, unknown>) => {
  return new NextRequest(`http://localhost${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const createBaseProperty = () => ({
  property_id: 'prop-1',
  address: baseAddress,
  city: 'Austin',
  state: 'TX',
  zip_code: '78701',
  bedrooms: 3,
  bathrooms: 2,
  property_type: 'Single Family',
  estimated_value: 295_000,
  primary_listing_price: 295_000,
  year_built: 2005,
  square_feet: 1800,
  value_source: 'avm' as const,
  value_range_low: 280_000,
  value_range_high: 310_000,
  listing_price_checked_at: '2026-04-16T12:00:00.000Z',
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()

  process.env.LEMONSQUEEZY_API_KEY = 'test-key'
  process.env.LEMONSQUEEZY_STORE_ID = 'store-1'
  process.env.LEMONSQUEEZY_VARIANT_SINGLE = '111'

  mockRateLimit.mockResolvedValue(false)
  mockGetClientIp.mockReturnValue('127.0.0.1')
  mockGetCurrentRates.mockResolvedValue({
    mortgage30yr: 0.065,
    mortgage15yr: 0.055,
    fedFundsRate: 0.05,
  })
  mockGetRentEstimate.mockResolvedValue({
    estimated_rent: 2200,
    rent_low: 2100,
    rent_high: 2300,
  })
  mockPrismaReportFindFirst.mockResolvedValue(null)
  mockPrismaReportCreate.mockResolvedValue(undefined)
  mockGetCurrentCustomer.mockResolvedValue(null)
  mockCreateCheckout.mockResolvedValue({
    data: {
      data: {
        attributes: {
          url: 'https://checkout.example.com/session',
        },
      },
    },
  })
})

describe('listing price route flow', () => {
  it('blocks preview when primary and fallback listing prices conflict materially', async () => {
    mockSearchProperty.mockResolvedValue({
      ...createBaseProperty(),
      fallback_listing_price: 275_000,
    })

    const { POST } = await import('../app/api/preview/route')
    const response = await POST(
      createRequest('/api/preview', {
        address: baseAddress,
      })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      listingPriceResolutionRequired: true,
      listingPriceStatus: 'conflicted',
      primaryListingPrice: 295_000,
      fallbackListingPrice: 275_000,
    })
    expect(mockPrismaReportCreate).not.toHaveBeenCalled()
  })

  it('accepts a user-confirmed listing price and persists the resolved teaser state', async () => {
    mockSearchProperty.mockResolvedValue({
      ...createBaseProperty(),
      fallback_listing_price: 275_000,
    })

    const { POST } = await import('../app/api/preview/route')
    const response = await POST(
      createRequest('/api/preview', {
        address: baseAddress,
        confirmedListingPrice: 275_000,
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      teaser: expect.objectContaining({
        listingPrice: 275_000,
        listingPriceSource: 'user-confirmed',
        listingPriceStatus: 'resolved',
        listingPriceUserSupplied: true,
      }),
    })

    const reportCreateCall = mockPrismaReportCreate.mock.calls[0][0]
    const persistedTeaserData = JSON.parse(reportCreateCall.data.teaserData)
    expect(persistedTeaserData).toMatchObject({
      listingPrice: 275_000,
      listingPriceSource: 'user-confirmed',
      listingPriceStatus: 'resolved',
      listingPriceUserSupplied: true,
      primaryListingPrice: 295_000,
      fallbackListingPrice: 275_000,
    })
  })

  it('blocks checkout when teaser data does not contain a resolved listing price', async () => {
    mockPrismaReportFindUnique.mockResolvedValue({
      id: 'report-1',
      paid: false,
      teaserData: JSON.stringify({
        listingPriceStatus: 'missing',
      }),
    })

    const { POST } = await import('../app/api/checkout/route')
    const response = await POST(
      createRequest('/api/checkout', {
        uuid: 'report-1',
        plan: 'single',
      })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'listing-price-unresolved',
    })
    expect(mockCreateCheckout).not.toHaveBeenCalled()
  })

  it('blocks checkout when a manually confirmed ask price is stale', async () => {
    mockPrismaReportFindUnique.mockResolvedValue({
      id: 'report-1',
      paid: false,
      teaserData: JSON.stringify({
        listingPrice: 275_000,
        listingPriceSource: 'user-confirmed',
        listingPriceStatus: 'resolved',
        listingPriceCheckedAt: '2026-04-14T12:00:00.000Z',
        listingPriceUserSupplied: true,
      }),
    })

    const { POST } = await import('../app/api/checkout/route')
    const response = await POST(
      createRequest('/api/checkout', {
        uuid: 'report-1',
        plan: 'single',
      })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'listing-price-stale',
    })
    expect(mockCreateCheckout).not.toHaveBeenCalled()
  })
})
