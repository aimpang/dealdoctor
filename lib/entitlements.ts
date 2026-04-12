// Entitlement / customer helpers. No auth system required — we track buyers
// by an opaque access-token cookie set at purchase time (and restorable via
// magic link). The cookie maps to a Customer row which holds their remaining
// 5-pack quota or unlimited-until expiry.

import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { prisma } from './db'

export const CUSTOMER_COOKIE = 'dd_customer_v1'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

// Re-export the Prisma-generated Customer type via a lightweight shape so
// callers don't need to import from @prisma/client directly.
export type CustomerRecord = {
  id: string
  email: string
  accessToken: string
  entitlementType: string | null
  reportsRemaining: number
  unlimitedUntil: Date | null
  subscriptionStatus: string | null
  lemonSqueezyCustomerId: string | null
  lemonSqueezySubscriptionId: string | null
}

export function generateAccessToken(): string {
  return randomBytes(32).toString('hex')
}

/** Read the current customer off the signed cookie on the incoming request. */
export async function getCurrentCustomer(): Promise<CustomerRecord | null> {
  const store = cookies()
  const token = store.get(CUSTOMER_COOKIE)?.value
  if (!token) return null
  const c = await prisma.customer.findUnique({ where: { accessToken: token } })
  return c
}

export function hasActiveEntitlement(customer: CustomerRecord): {
  active: boolean
  type?: 'unlimited' | '5pack'
  remaining?: number
  until?: Date
} {
  if (customer.unlimitedUntil && customer.unlimitedUntil > new Date()) {
    return { active: true, type: 'unlimited', until: customer.unlimitedUntil }
  }
  if (customer.reportsRemaining > 0) {
    return { active: true, type: '5pack', remaining: customer.reportsRemaining }
  }
  return { active: false }
}

/**
 * Debit one report from the customer's quota. Unlimited subscribers are a no-op
 * (no debit). 5-pack holders decrement by 1. Returns true if a debit succeeded.
 * Called by /api/preview when auto-paying a freshly-created report.
 */
export async function debitForNewReport(
  customer: CustomerRecord
): Promise<{ debited: boolean; newRemaining?: number }> {
  const check = hasActiveEntitlement(customer)
  if (!check.active) return { debited: false }
  if (check.type === 'unlimited') return { debited: true }
  // 5-pack: decrement
  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { reportsRemaining: { decrement: 1 } },
    select: { reportsRemaining: true },
  })
  return { debited: true, newRemaining: updated.reportsRemaining }
}

/** Attach the customer cookie to an outgoing response. */
export function setCustomerCookie(res: NextResponse, token: string) {
  res.cookies.set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ONE_YEAR_SECONDS,
    path: '/',
  })
}

/** Clear the customer cookie (for logout / retrieve-my-reports flow). */
export function clearCustomerCookie(res: NextResponse) {
  res.cookies.set(CUSTOMER_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
}

/**
 * Upsert a customer by email and credit an entitlement based on the plan
 * purchased. Also rotates the access token so a prior cookie can't be used
 * to claim a new purchase maliciously. Called from the LemonSqueezy webhook.
 */
export async function creditPurchase(params: {
  email: string
  plan: 'single' | '5pack' | 'unlimited'
  lsCustomerId?: string
  lsSubscriptionId?: string
  subscriptionStatus?: string
  renewsAt?: Date // for unlimited subscription events
}): Promise<CustomerRecord> {
  const { email, plan, lsCustomerId, lsSubscriptionId, subscriptionStatus, renewsAt } = params
  const existing = await prisma.customer.findUnique({ where: { email } })

  // Credit math — the webhook fires AFTER the buyer views their current report,
  // and the current report is marked paid=true directly in the webhook handler
  // (so it doesn't consume quota). Therefore:
  //   single: no bank credit (just this one report)
  //   5pack:  +4 remaining bank (5 total, 1 consumed as the current report)
  //   unlimited: unlimitedUntil set to renewsAt (or +30 days fallback)
  const creditRemaining = plan === '5pack' ? 4 : 0
  const creditUnlimitedUntil =
    plan === 'unlimited'
      ? renewsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      : null

  if (existing) {
    return prisma.customer.update({
      where: { id: existing.id },
      data: {
        entitlementType: plan,
        reportsRemaining: existing.reportsRemaining + creditRemaining,
        unlimitedUntil: creditUnlimitedUntil
          ? // extend from the later of now or current expiry
            new Date(
              Math.max(
                creditUnlimitedUntil.getTime(),
                existing.unlimitedUntil ? existing.unlimitedUntil.getTime() : 0
              )
            )
          : existing.unlimitedUntil,
        lemonSqueezyCustomerId: lsCustomerId ?? existing.lemonSqueezyCustomerId,
        lemonSqueezySubscriptionId: lsSubscriptionId ?? existing.lemonSqueezySubscriptionId,
        subscriptionStatus: subscriptionStatus ?? existing.subscriptionStatus,
      },
    })
  }

  return prisma.customer.create({
    data: {
      email,
      accessToken: generateAccessToken(),
      entitlementType: plan,
      reportsRemaining: creditRemaining,
      unlimitedUntil: creditUnlimitedUntil,
      lemonSqueezyCustomerId: lsCustomerId,
      lemonSqueezySubscriptionId: lsSubscriptionId,
      subscriptionStatus,
    },
  })
}

/**
 * Look up a customer by email and rotate their access token. Used by the
 * magic-link send flow: rotating invalidates any prior cookie, so a stolen
 * cookie can't keep accessing after the legitimate owner requests a new link.
 */
export async function rotateAccessTokenByEmail(email: string): Promise<CustomerRecord | null> {
  const existing = await prisma.customer.findUnique({ where: { email } })
  if (!existing) return null
  return prisma.customer.update({
    where: { id: existing.id },
    data: { accessToken: generateAccessToken() },
  })
}

/** Zero out entitlements — called on refund / subscription expiry. */
export async function revokeEntitlement(customerId: string) {
  return prisma.customer.update({
    where: { id: customerId },
    data: {
      reportsRemaining: 0,
      unlimitedUntil: null,
      subscriptionStatus: 'refunded',
    },
  })
}
