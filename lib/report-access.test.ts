import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCustomerFindUnique, mockPurchaseFindUnique } = vi.hoisted(() => ({
  mockCustomerFindUnique: vi.fn(),
  mockPurchaseFindUnique: vi.fn(),
}))

vi.mock('./db', () => ({
  prisma: {
    customer: {
      findUnique: mockCustomerFindUnique,
    },
    purchase: {
      findUnique: mockPurchaseFindUnique,
    },
  },
}))

vi.mock('./shareToken', () => ({
  verifyShareToken: vi.fn(() => true),
}))

vi.mock('./debugAccess', () => ({
  isDebugAccessAuthorized: vi.fn(() => false),
}))

import { resolveReportAccess } from './report-access'

describe('resolveReportAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCustomerFindUnique.mockResolvedValue(null)
    mockPurchaseFindUnique.mockResolvedValue(null)
  })

  it('denies owner and share-token access when the linked purchase was refunded', async () => {
    mockCustomerFindUnique.mockResolvedValue({ id: 'cust_1' })
    mockPurchaseFindUnique.mockResolvedValue({ status: 'refunded' })

    const access = await resolveReportAccess({
      cookieAccessToken: 'token-1',
      reportCustomerId: 'cust_1',
      reportId: 'report-1',
      reportPurchaseId: 'purchase-1',
      tokenCandidate: 'share-token',
    })

    expect(access.hasAccess).toBe(false)
    expect(access.isOwner).toBe(true)
    expect(access.tokenRevokedByRefund).toBe(true)
    expect(access.accessGrantedVia).toBe('none')
  })

  it('keeps owner access for legacy reports without purchaseId even when token sharing is revoked', async () => {
    mockCustomerFindUnique
      .mockResolvedValueOnce({ id: 'cust_1' })
      .mockResolvedValueOnce({ subscriptionStatus: 'refunded' })

    const access = await resolveReportAccess({
      cookieAccessToken: 'token-1',
      reportCustomerId: 'cust_1',
      reportId: 'report-legacy',
      tokenCandidate: 'share-token',
    })

    expect(access.hasAccess).toBe(true)
    expect(access.isOwner).toBe(true)
    expect(access.effectiveTokenValid).toBe(false)
    expect(access.tokenRevokedByRefund).toBe(true)
    expect(access.accessGrantedVia).toBe('owner')
  })
})
