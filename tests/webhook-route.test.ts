import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockWebhookEventCreate = vi.fn()
const mockWebhookEventDeleteMany = vi.fn()
const mockCustomerFindUnique = vi.fn()
const mockCustomerUpdateMany = vi.fn()
const mockCustomerUpsert = vi.fn()
const mockPrismaTransaction = vi.fn()
const mockRefundPurchaseByProviderOrderId = vi.fn()
const mockGenerateAccessToken = vi.fn()
const mockGenerateRecoveryCode = vi.fn()

const mockPrisma = {
  webhookEvent: {
    create: mockWebhookEventCreate,
    deleteMany: mockWebhookEventDeleteMany,
  },
  customer: {
    findUnique: mockCustomerFindUnique,
    updateMany: mockCustomerUpdateMany,
    upsert: mockCustomerUpsert,
  },
  report: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: mockPrismaTransaction,
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/purchase-ledger', () => ({
  refundPurchaseByProviderOrderId: mockRefundPurchaseByProviderOrderId,
  createPurchaseFromOrderCreated: vi.fn(),
  createOrRefreshSubscriptionPurchase: vi.fn(),
  getActiveEntitlementForCustomer: vi.fn(),
  debitFivePackPurchaseForReport: vi.fn(),
  cancelSubscriptionPurchase: vi.fn(),
  expireSubscriptionPurchase: vi.fn(),
}))

vi.mock('@/lib/entitlements', () => ({
  generateAccessToken: mockGenerateAccessToken,
  generateRecoveryCode: mockGenerateRecoveryCode,
}))

vi.mock('@/lib/reportGenerator', () => ({
  generateFullReport: vi.fn(),
}))

vi.mock('@/lib/email-service', () => ({
  sendEmail: vi.fn(),
  buildPurchaseReceiptEmail: vi.fn(() => ({
    html: '<p>ok</p>',
    text: 'ok',
  })),
}))

vi.mock('@/lib/claim-token', () => ({
  RECEIPT_CLAIM_TOKEN_TTL_DAYS: 7,
  RECEIPT_CLAIM_TOKEN_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  createClaimToken: vi.fn(() => 'claim-token'),
}))

vi.mock('@/lib/seo', () => ({
  BASE_URL: 'https://dealdoctor.us',
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

const createSignedWebhookRequest = (payload: Record<string, unknown>) => {
  const rawBody = JSON.stringify(payload)
  const signature = crypto
    .createHmac('sha256', process.env.LEMONSQUEEZY_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest('hex')

  return new NextRequest('http://localhost/api/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': signature,
    },
    body: rawBody,
  })
}

const buildRefundPayload = (overrides: Record<string, unknown> = {}) => ({
  meta: {
    event_name: 'order_refunded',
    event_id: 'evt_refund_1',
  },
  data: {
    id: 'ord_123',
    attributes: {
      user_email: 'buyer@example.com',
      refunded_at: '2026-04-16T16:00:00.000Z',
      refunded_amount: 2499,
      total: 2499,
    },
  },
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.useRealTimers()

  process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'whsec_test'

  mockWebhookEventCreate.mockResolvedValue({})
  mockWebhookEventDeleteMany.mockResolvedValue({ count: 1 })
  mockCustomerUpsert.mockResolvedValue({
    id: 'cust_1',
    email: 'buyer@example.com',
    accessToken: 'token-1',
    recoveryCode: 'DD-ABCD-EFGH',
    lemonSqueezyCustomerId: 'ls-customer-1',
    lemonSqueezySubscriptionId: null,
  })
  mockCustomerUpdateMany.mockResolvedValue({ count: 1 })
  mockCustomerFindUnique.mockResolvedValue({
    id: 'cust_1',
    email: 'buyer@example.com',
  })
  mockGenerateAccessToken.mockReturnValue('token-1')
  mockGenerateRecoveryCode.mockReturnValue('DD-ABCD-EFGH')
  mockPrismaTransaction.mockImplementation(async (callback: any) => callback(mockPrisma))
})

describe('webhook refund handling', () => {
  it('does not revoke unrelated purchases when one refunded order is processed', async () => {
    mockRefundPurchaseByProviderOrderId.mockResolvedValue({
      outcome: 'full-refund-applied',
      purchaseId: 'purchase_1',
      revokedReportIds: ['report_a', 'report_b'],
    })

    const { POST } = await import('../app/api/webhook/route')
    const response = await POST(createSignedWebhookRequest(buildRefundPayload()))

    expect(response.status).toBe(200)
    expect(mockRefundPurchaseByProviderOrderId).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEventId: 'evt_refund_1',
        providerOrderId: 'ord_123',
        refundedAmountCents: 2499,
        orderTotalCents: 2499,
        eventCreatedAt: expect.any(Date),
      }),
      expect.anything()
    )
  })

  it('returns 500 and releases webhook dedupe when a fresh refunded order is unknown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-16T16:05:00.000Z'))

    mockRefundPurchaseByProviderOrderId.mockResolvedValue({
      outcome: 'purchase-not-found',
    })

    const freshRefundPayload = buildRefundPayload({
      data: {
        id: 'ord_missing',
        attributes: {
          user_email: 'buyer@example.com',
          refunded_at: '2026-04-16T16:00:00.000Z',
          refunded_amount: 2499,
          total: 2499,
        },
      },
    })

    const { POST } = await import('../app/api/webhook/route')
    // Freshness is asserted implicitly by the 500 response for a refund
    // inside the retry window.
    const response = await POST(createSignedWebhookRequest(freshRefundPayload))

    expect(response.status).toBe(500)
    expect(mockWebhookEventDeleteMany).toHaveBeenCalledWith({
      where: { providerEventId: 'evt_refund_1' },
    })
  })

  it('returns 200 for a stale unknown refunded order so orphaned retries do not loop forever', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-16T16:20:00.000Z'))

    mockRefundPurchaseByProviderOrderId.mockResolvedValue({
      outcome: 'purchase-not-found',
    })

    const staleRefundPayload = buildRefundPayload()

    const { POST } = await import('../app/api/webhook/route')
    const response = await POST(createSignedWebhookRequest(staleRefundPayload))

    expect(response.status).toBe(200)
    expect(mockWebhookEventDeleteMany).not.toHaveBeenCalled()
  })

  it('returns 200 for a partial refund and keeps the purchase on manual-review path', async () => {
    mockRefundPurchaseByProviderOrderId.mockResolvedValue({
      outcome: 'partial-refund-manual-review',
      purchaseId: 'purchase_1',
    })

    const partialRefundPayload = buildRefundPayload({
      data: {
        id: 'ord_123',
        attributes: {
          user_email: 'buyer@example.com',
          refunded_at: '2026-04-16T16:00:00.000Z',
          refunded_amount: 1000,
          total: 2499,
        },
      },
    })

    const { POST } = await import('../app/api/webhook/route')
    const response = await POST(createSignedWebhookRequest(partialRefundPayload))

    expect(response.status).toBe(200)
    expect(mockWebhookEventDeleteMany).not.toHaveBeenCalled()
  })
})
