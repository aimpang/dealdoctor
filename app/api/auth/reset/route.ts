import { NextRequest, NextResponse } from 'next/server'
import { clearCustomerCookie } from '@/lib/entitlements'

// Dev-only: clears the dd_customer_v1 entitlement cookie and redirects home.
// Useful when testing the paywall / report-generation flow on a browser where
// a prior test purchase set a cookie that auto-pays every new preview.
// Hard-gated on NODE_ENV so it can never be used in production to grief
// legitimate customers.

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 })
  }
  const response = NextResponse.redirect(new URL('/?reset=ok', req.url))
  clearCustomerCookie(response)
  return response
}
