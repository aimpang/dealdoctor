import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { setCustomerCookie } from '@/lib/entitlements'

// Magic-link claim endpoint. Users click the link from their purchase receipt
// (or the "retrieve my access" email) and this sets the customer cookie on
// whatever device they clicked from. Then they can navigate the site and
// their 5-pack / Unlimited entitlement applies.
//
// Landing destination: /portfolio — shows their saved deals + implicit
// confirmation that the claim worked.

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/?claim=invalid', req.url))
  }

  const customer = await prisma.customer.findUnique({
    where: { accessToken: token },
    select: { id: true, accessToken: true },
  })

  if (!customer) {
    return NextResponse.redirect(new URL('/?claim=expired', req.url))
  }

  const response = NextResponse.redirect(new URL('/portfolio?claim=ok', req.url))
  setCustomerCookie(response, customer.accessToken)
  return response
}
