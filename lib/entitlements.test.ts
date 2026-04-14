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
  enforceEntitlementExpiry,
  generateRecoveryCode,
  restoreByRecoveryCode,
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
    ;(prisma.customer.updateMany as any).mockResolvedValue({ count: 0 })
    const r = await debitForNewReport(c)
    expect(r.debited).toBe(false)
    expect(prisma.customer.update).not.toHaveBeenCalled()
    expect(prisma.customer.findUnique).not.toHaveBeenCalled()
  })

  it('returns debited:true and does NOT decrement for unlimited', async () => {
    const future = new Date(Date.now() + 60_000)
    const c = baseCustomer({ unlimitedUntil: future })
    const r = await debitForNewReport(c)
    expect(r.debited).toBe(true)
    expect(r.newRemaining).toBeUndefined()
    expect(prisma.customer.update).not.toHaveBeenCalled()
    expect(prisma.customer.updateMany).not.toHaveBeenCalled()
  })

  it('decrements reportsRemaining by 1 for 5pack via conditional updateMany', async () => {
    const c = baseCustomer({ reportsRemaining: 4 })
    ;(prisma.customer.updateMany as any).mockResolvedValue({ count: 1 })
    ;(prisma.customer.findUnique as any).mockResolvedValue({ reportsRemaining: 3 })
    const r = await debitForNewReport(c)
    expect(r.debited).toBe(true)
    expect(r.newRemaining).toBe(3)
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: { id: c.id, reportsRemaining: { gt: 0 } },
      data: { reportsRemaining: { decrement: 1 } },
    })
    expect(prisma.customer.findUnique).toHaveBeenCalledWith({
      where: { id: c.id },
      select: { reportsRemaining: true },
    })
  })

  it('returns debited:false when updateMany finds no rows (lost race on last credit)', async () => {
    const c = baseCustomer({ reportsRemaining: 1 })
    ;(prisma.customer.updateMany as any).mockResolvedValue({ count: 0 })
    const r = await debitForNewReport(c)
    expect(r.debited).toBe(false)
    expect(r.newRemaining).toBeUndefined()
    expect(prisma.customer.findUnique).not.toHaveBeenCalled()
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

// Gap #3 regression — lazy expiry sweep. If LemonSqueezy's subscription_expired
// webhook fires late or never, a customer's unlimitedUntil date lapses but
// their subscriptionStatus stays "active" in the DB. The sweep fixes this on
// the next preview call so the customer isn't effectively getting free
// unlimited access past their paid period.
describe('enforceEntitlementExpiry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('no-ops when customer has no unlimitedUntil (single / 5pack / nothing)', async () => {
    const c = baseCustomer()
    const result = await enforceEntitlementExpiry(c)
    expect(result).toBe(c) // same reference — no DB write
    expect(prisma.customer.update).not.toHaveBeenCalled()
  })

  it('no-ops when unlimitedUntil is still in the future', async () => {
    const c = baseCustomer({
      unlimitedUntil: new Date(Date.now() + 7 * 24 * 3600_000), // +7d
      subscriptionStatus: 'active',
    })
    const result = await enforceEntitlementExpiry(c)
    expect(result).toBe(c)
    expect(prisma.customer.update).not.toHaveBeenCalled()
  })

  it('sweeps expired unlimited access to status=expired + unlimitedUntil=null', async () => {
    const c = baseCustomer({
      unlimitedUntil: new Date(Date.now() - 24 * 3600_000), // yesterday
      subscriptionStatus: 'active',
    })
    const swept = {
      ...c,
      unlimitedUntil: null,
      subscriptionStatus: 'expired',
    }
    vi.mocked(prisma.customer.update).mockResolvedValue(swept as any)
    const result = await enforceEntitlementExpiry(c)
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: c.id },
      data: { unlimitedUntil: null, subscriptionStatus: 'expired' },
    })
    expect(result.subscriptionStatus).toBe('expired')
  })

  it('no-ops if already marked expired (idempotent)', async () => {
    const c = baseCustomer({
      unlimitedUntil: new Date(Date.now() - 86400_000),
      subscriptionStatus: 'expired',
    })
    const result = await enforceEntitlementExpiry(c)
    expect(result).toBe(c)
    expect(prisma.customer.update).not.toHaveBeenCalled()
  })

  it('no-ops if refunded (refund already revoked)', async () => {
    const c = baseCustomer({
      unlimitedUntil: new Date(Date.now() - 86400_000),
      subscriptionStatus: 'refunded',
    })
    await enforceEntitlementExpiry(c)
    expect(prisma.customer.update).not.toHaveBeenCalled()
  })
})

// Gap #5 regression — recovery code flow. Buyer loses the magic-link email
// and clears cookies — they paste the code from their receipt and we restore
// access by rotating the session token.
describe('generateRecoveryCode', () => {
  it('produces DD-XXXX-XXXX format', () => {
    const code = generateRecoveryCode()
    expect(code).toMatch(/^DD-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  })

  it('excludes easily-confused characters (0, O, 1, I)', () => {
    // Stat sample: 200 codes → none should contain any of the four.
    for (let i = 0; i < 200; i++) {
      const c = generateRecoveryCode()
      expect(c).not.toMatch(/[01OI]/)
    }
  })

  it('is unique across calls (no duplicates in 100 samples)', () => {
    const set = new Set<string>()
    for (let i = 0; i < 100; i++) set.add(generateRecoveryCode())
    expect(set.size).toBe(100)
  })
})

describe('restoreByRecoveryCode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when code does not match any customer', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null)
    const result = await restoreByRecoveryCode('DD-XXXX-XXXX')
    expect(result).toBeNull()
  })

  it('normalizes the code (uppercase + trim) before lookup', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer() as any)
    vi.mocked(prisma.customer.update).mockResolvedValue(
      baseCustomer({ accessToken: 'rotated' }) as any
    )
    await restoreByRecoveryCode('  dd-abcd-efgh  ')
    expect(prisma.customer.findUnique).toHaveBeenCalledWith({
      where: { recoveryCode: 'DD-ABCD-EFGH' },
    })
  })

  it('rotates accessToken on successful match', async () => {
    const existing = baseCustomer({ accessToken: 'old_token' })
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(existing as any)
    vi.mocked(prisma.customer.update).mockImplementation((args: any) => ({
      ...existing,
      accessToken: args.data.accessToken,
    }) as any)
    const result = await restoreByRecoveryCode('DD-ABCD-EFGH')
    expect(result!.accessToken).not.toBe('old_token')
    expect(result!.accessToken).toMatch(/^[0-9a-f]{64}$/)
  })
})

// Gap #2 context — creditPurchase now attaches a recoveryCode to new customers.
describe('creditPurchase — recovery code assignment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('assigns a recovery code to brand-new customers', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null)
    const created = { id: 'new', email: 'x@y.com', accessToken: 'a', recoveryCode: 'DD-XXXX-YYYY' }
    vi.mocked(prisma.customer.create).mockImplementation((args: any) => {
      // Capture the shape passed to create so we can assert the helper is calling it
      expect(args.data).toHaveProperty('recoveryCode')
      expect(args.data.recoveryCode).toMatch(/^DD-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
      return created as any
    })
    await creditPurchase({ email: 'x@y.com', plan: 'single' })
    expect(prisma.customer.create).toHaveBeenCalled()
  })

  it('does NOT overwrite an existing customer\'s recovery code on re-purchase', async () => {
    const existing = baseCustomer({ email: 'returning@y.com' })
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(existing as any)
    vi.mocked(prisma.customer.update).mockImplementation((args: any) => {
      // update path should NOT touch recoveryCode
      expect(args.data).not.toHaveProperty('recoveryCode')
      return { ...existing, ...args.data } as any
    })
    await creditPurchase({ email: 'returning@y.com', plan: '5pack' })
    expect(prisma.customer.update).toHaveBeenCalled()
  })
})
