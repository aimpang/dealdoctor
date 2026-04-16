import { NextRequest, NextResponse } from 'next/server'
import { restoreByRecoveryCode, setCustomerCookie } from '@/lib/entitlements'
import { getClientIp } from '@/lib/clientIp'
import { rateLimit } from '@/lib/rateLimit'

// Recovery-code restore. The buyer lost their magic-link email AND cleared
// their cookies — they paste the recovery code from their purchase receipt
// and we set the customer cookie on the current browser. Complements the
// magic-link flow (send-magic-link + claim) — same outcome, different signal.
//
// Security: the code is a 10-char alphanumeric (no 0/O/1/I) from a 32-char
// alphabet ≈ 2^50 search space per attempt. Rate-limiting protects against
// brute force.

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (await rateLimit(ip, 10, { bucket: 'recovery-code', failOpen: false, windowMs: 60 * 60 * 1000 })) {
    return NextResponse.json({ error: 'Too many recovery attempts. Try again in an hour.' }, { status: 429 })
  }

  const { code } = await req.json().catch(() => ({}))
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Missing recovery code' }, { status: 400 })
  }

  const customer = await restoreByRecoveryCode(code)
  if (!customer) {
    return NextResponse.json(
      { error: "That recovery code didn't match any of our records. Double-check the code from your purchase receipt." },
      { status: 404 }
    )
  }

  const res = NextResponse.json({
    ok: true,
    email: customer.email,
    entitlementType: customer.entitlementType,
    reportsRemaining: customer.reportsRemaining,
  })
  setCustomerCookie(res, customer.accessToken)
  return res
}
