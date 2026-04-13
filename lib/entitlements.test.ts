import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma so tests don't require a live DB. The mock state is reset
// between tests via beforeEach — otherwise assertion counts leak.
vi.mock('./db', () => ({
  prisma: {
    customer: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    report: {
      update: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

// cookies() reads from the incoming Request in Next.js — we fake it.
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: vi.fn(),
    set: vi.fn(),
  }),
}))

// Import AFTER mocks are registered
import {
  hasActiveEntitlement,
  debitForNewReport,
  creditPurchase,
  revokeEntitlement,
  rotateAccessTokenByEmail,
  generateAccessToken,
  type CustomerRecord,
} from './entitlements'
import { prisma } from './db'

const baseCustomer = (over: Partial<CustomerRecord> = {}): CustomerRecord => ({
  id: 'cust_test',
  email: 'test@example.com',
  accessToken: 'tok_abc',
  entitlementType: null,
  reportsRemaining: 0,
  unlimitedUntil: null,
  subscriptionStatus: null,
  lemonSqueezyCustomerId: null,
  lemonSqueezySubscriptionId: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ──────────────────────────────────────────────────────────────
// generateAccessToken
// ──────────────────────────────────────────────────────────────
describe('generateAccessToken', () => {
  it('returns 64-char hex', () => {
    const t = generateAccessToken()
    expect(t).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces unique tokens across 100 calls', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 100; i++) tokens.add(generateAccessToken())
    expect(tokens.size).toBe(100)
  })
})

// ──────────────────────────────────────────────────────────────
// hasActiveEntitlement — the auto-pay gate
// If this logic flips wrong, we either lose money (give free reports)
// or lose customers (show paywall to a paid user).
// ──────────────────────────────────────────────────────────────
describe('hasActiveEntitlement', () => {
  it('inactive when reportsRemaining=0 and no unlimitedUntil', () => {
    const r = hasActiveEntitlement(baseCustomer())
    expect(r.active).toBe(false)
  })

  it('active for 5pack when reportsRemaining > 0', () => {
    const r = hasActiveEntitlement(baseCustomer({ reportsRemaining: 3 }))
    expect(r.active).toBe(true)
    expect(r.type).toBe('5pack')
    expect(r.remaining).toBe(3)
  })

  it('active for unlimited when unlimitedUntil is in the future', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const r = hasActiveEntitlement(baseCustomer({ unlimitedUntil: future }))
    expect(r.active).toBe(true)
    expect(r.type).toBe('unlimited')
    expect(r.until).toEqual(future)
  })

  it('inactive when unlimitedUntil is in the past', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const r = hasActiveEntitlement(baseCustomer({ unlimitedUntil: past }))
    expect(r.active).toBe(false)
  })

  it('prefers unlimited over 5pack when both present', () => {
    const future = new Date(Date.now() + 60_000)
    const r = hasActiveEntitlement(
      baseCustomer({ unlimitedUntil: future, reportsRemaining: 5 })
    )
    expect(r.type).toBe('unlimited')
  })
})

// ──────────────────────────────────────────────────────────────
// debitForNewReport — called by /api/preview on every new report
// ──────────────────────────────────────────────────────────────
describe('debitForNewReport', () => {
  it('returns debited:false when customer has no active entitlement', async () => {
    const c = baseCustomer()
    const r = await debitForNewReport(c)
    expect(r.debited).toBe(false)
    expect(prisma.customer.update).not.toHaveBeenCalled()
  })

  it('returns debited:true and does NOT decrement for unlimited', async () => {
    const future = new Date(Date.now() + 60_000)
    const c = baseCustomer({ unlimitedUntil: future })
    const r = await debitForNewReport(c)
    expect(r.debited).toBe(true)
    expect(r.newRemaining).toBeUndefined()
    expect(prisma.customer.update).not.toHaveBeenCalled()
  })

  it('decrements reportsRemaining by 1 for 5pack', async () => {
    const c = baseCustomer({ reportsRemaining: 4 })
    ;(prisma.customer.update as any).mockResolvedValue({ reportsRemaining: 3 })
    const r = await debitForNewReport(c)
    expect(r.debited).toBe(true)
    expect(r.newRemaining).toBe(3)
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: c.id },
      data: { reportsRemaining: { decrement: 1 } },
      select: { reportsRemaining: true },
    })
  })
})

// ──────────────────────────────────────────────────────────────
// creditPurchase — the critical webhook handler. These tests are the
// difference between "5-pack works" and "5-pack refund magnet."
// ──────────────────────────────────────────────────────────────
describe('creditPurchase', () => {
  it('new Single customer: entitlementType=single, remaining=0 (just the 1 report)', async () => {
    ;(prisma.customer.findUnique as any).mockResolvedValue(null)
    ;(prisma.customer.create as any).mockImplementation(({ data }: any) => ({
      ...baseCustomer(),
      ...data,
    }))

    await creditPurchase({ email: 'sarah@test.com', plan: 'single' })

    expect(prisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'sarah@test.com',
          entitlementType: 'single',
          reportsRemaining: 0,
          unlimitedUntil: null,
        }),
      })
    )
  })

  it('new 5-pack customer: reportsRemaining=4 (one consumed for the report paid on)', async () => {
    ;(prisma.customer.findUnique as any).mockResolvedValue(null)
    ;(prisma.customer.create as any).mockImplementation(({ data }: any) => ({
      ...baseCustomer(),
      ...data,
    }))

    await creditPurchase({ email: 'marcus@test.com', plan: '5pack' })

    expect(prisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entitlementType: '5pack',
          reportsRemaining: 4,
        }),
      })
    )
  })

  it('new Unlimited customer: unlimitedUntil set from renewsAt when provided', async () => {
    ;(prisma.customer.findUnique as any).mockResolvedValue(null)
    ;(prisma.customer.create as any).mockImplementation(({ data }: any) => ({
      ...baseCustomer(),
      ...data,
    }))
    const renewsAt = new Date('2026-12-31T00:00:00Z')

    await creditPurchase({ email: 'diana@test.com', plan: 'unlimited', renewsAt })

    const call = (prisma.customer.create as any).mock.calls[0][0]
    expect(call.data.entitlementType).toBe('unlimited')
    expect(call.data.unlimitedUntil).toEqual(renewsAt)
  })

  it('new Unlimited without renewsAt: falls back to +30 days', async () => {
    ;(prisma.customer.findUnique as any).mockResolvedValue(null)
    ;(prisma.customer.create as any).mockImplementation(({ data }: any) => ({
      ...baseCustomer(),
      ...data,
    }))
    const before = Date.now()

    await creditPurchase({ email: 'diana@test.com', plan: 'unlimited' })

    const call = (prisma.customer.create as any).mock.calls[0][0]
    const until = call.data.unlimitedUntil as Date
    // Should be roughly now + 30 days
    const expectedMin = before + 29.9 * 24 * 60 * 60 * 1000
    const expectedMax = before + 30.1 * 24 * 60 * 60 * 1000
    expect(until.getTime()).toBeGreaterThan(expectedMin)
    expect(until.getTime()).toBeLessThan(expectedMax)
  })

  it('existing 5-pack customer + buys another 5-pack: remaining STACKS (3 + 4 = 7)', async () => {
    ;(prisma.customer.findUnique as any).mockResolvedValue(
      baseCustomer({ id: 'cust_1', reportsRemaining: 3, entitlementType: '5pack' })
    )
    ;(prisma.customer.update as any).mockImplementation(({ data }: any) => ({
      ...baseCustomer({ id: 'cust_1', reportsRemaining: 3 }),
      ...data,
    }))

    await creditPurchase({ email: 'marcus@test.com', plan: '5pack' })

    const call = (prisma.customer.update as any).mock.calls[0][0]
    expect(call.data.reportsRemaining).toBe(7) // 3 existing + 4 credit
    expect(call.data.entitlementType).toBe('5pack')
  })

  it('existing Unlimited customer + renewal: extends to the LATER of current and new', async () => {
    const existingUntil = new Date('2026-06-01T00:00:00Z')
    const newRenewal = new Date('2026-07-15T00:00:00Z')
    ;(prisma.customer.findUnique as any).mockResolvedValue(
      baseCustomer({ id: 'cust_2', unlimitedUntil: existingUntil })
    )
    ;(prisma.customer.update as any).mockImplementation(({ data }: any) => data)

    await creditPurchase({ email: 'diana@test.com', plan: 'unlimited', renewsAt: newRenewal })

    const call = (prisma.customer.update as any).mock.calls[0][0]
    expect(call.data.unlimitedUntil).toEqual(newRenewal)
  })

  it('existing Unlimited customer + renewsAt BEFORE current: keeps later date (never shortens)', async () => {
    const existingUntil = new Date('2026-09-01T00:00:00Z')
    const newRenewal = new Date('2026-07-01T00:00:00Z') // earlier (edge case)
    ;(prisma.customer.findUnique as any).mockResolvedValue(
      baseCustomer({ id: 'cust_3', unlimitedUntil: existingUntil })
    )
    ;(prisma.customer.update as any).mockImplementation(({ data }: any) => data)

    await creditPurchase({ email: 'diana@test.com', plan: 'unlimited', renewsAt: newRenewal })

    const call = (prisma.customer.update as any).mock.calls[0][0]
    // Customer keeps the longer expiry — renewals never shorten access
    expect(call.data.unlimitedUntil).toEqual(existingUntil)
  })

  it('existing non-unlimited customer upgrades to Unlimited: sets unlimitedUntil fresh', async () => {
    ;(prisma.customer.findUnique as any).mockResolvedValue(
      baseCustomer({ id: 'cust_4', entitlementType: '5pack', reportsRemaining: 2 })
    )
    ;(prisma.customer.update as any).mockImplementation(({ data }: any) => data)

    const renewsAt = new Date('2026-08-01T00:00:00Z')
    await creditPurchase({ email: 'upgrade@test.com', plan: 'unlimited', renewsAt })

    const call = (prisma.customer.update as any).mock.calls[0][0]
    expect(call.data.unlimitedUntil).toEqual(renewsAt)
    expect(call.data.entitlementType).toBe('unlimited')
    // 5-pack remaining is preserved — upgrading shouldn't burn their bank
    expect(call.data.reportsRemaining).toBe(2)
  })

  it('preserves LS subscription ID on renewal events', async () => {
    ;(prisma.customer.findUnique as any).mockResolvedValue(
      baseCustomer({ id: 'cust_5', lemonSqueezySubscriptionId: 'sub_abc' })
    )
    ;(prisma.customer.update as any).mockImplementation(({ data }: any) => data)

    await creditPurchase({
      email: 'd@t.com',
      plan: 'unlimited',
      lsSubscriptionId: 'sub_xyz',
      subscriptionStatus: 'active',
    })

    const call = (prisma.customer.update as any).mock.calls[0][0]
    expect(call.data.lemonSqueezySubscriptionId).toBe('sub_xyz')
    expect(call.data.subscriptionStatus).toBe('active')
  })
})

// ──────────────────────────────────────────────────────────────
// revokeEntitlement — refund handler
// ──────────────────────────────────────────────────────────────
describe('revokeEntitlement', () => {
  it('zeroes reportsRemaining AND unlimitedUntil AND marks status refunded', async () => {
    ;(prisma.customer.update as any).mockImplementation(({ data }: any) => data)

    await revokeEntitlement('cust_refund')

    const call = (prisma.customer.update as any).mock.calls[0][0]
    expect(call.where).toEqual({ id: 'cust_refund' })
    expect(call.data).toEqual({
      reportsRemaining: 0,
      unlimitedUntil: null,
      subscriptionStatus: 'refunded',
    })
  })
})

// ──────────────────────────────────────────────────────────────
// rotateAccessTokenByEmail — magic-link send flow
// Rotation security: stolen cookies stop working on next link request.
// ──────────────────────────────────────────────────────────────
describe('rotateAccessTokenByEmail', () => {
  it('returns null when email not found (anti-enumeration caller handles 200)', async () => {
    ;(prisma.customer.findUnique as any).mockResolvedValue(null)
    const r = await rotateAccessTokenByEmail('ghost@test.com')
    expect(r).toBeNull()
    expect(prisma.customer.update).not.toHaveBeenCalled()
  })

  it('rotates access token for existing customer and returns updated record', async () => {
    const existing = baseCustomer({ id: 'cust_rot', accessToken: 'old_token' })
    ;(prisma.customer.findUnique as any).mockResolvedValue(existing)
    ;(prisma.customer.update as any).mockImplementation(({ data }: any) => ({
      ...existing,
      ...data,
    }))

    const result = await rotateAccessTokenByEmail('test@example.com')

    expect(result).not.toBeNull()
    expect(result!.accessToken).not.toBe('old_token')
    expect(result!.accessToken).toMatch(/^[0-9a-f]{64}$/)
  })
})
