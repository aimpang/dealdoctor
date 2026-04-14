import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { CUSTOMER_COOKIE } from '@/lib/entitlements'
import { signShareToken } from '@/lib/shareToken'

// Issues a signed share-link token for a given report UUID. Only the report's
// OWNER (session cookie matches report.customerId) can mint a token. Anyone
// else gets 403. The owner passes the returned token to any recipient — the
// recipient uses /report/<uuid>?t=<token> to get full access without needing
// a cookie of their own.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const uuid = searchParams.get('uuid')
  if (!uuid) {
    return NextResponse.json({ error: 'Missing uuid parameter' }, { status: 400 })
  }

  const report = await prisma.report.findUnique({ where: { id: uuid } })
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

  const cookieToken = req.cookies.get(CUSTOMER_COOKIE)?.value
  if (!cookieToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!(report as any).customerId) {
    return NextResponse.json(
      { error: 'This report has no owner — share tokens unavailable' },
      { status: 409 }
    )
  }
  const customer = await prisma.customer.findUnique({
    where: { accessToken: cookieToken },
    select: { id: true },
  })
  if (!customer || customer.id !== (report as any).customerId) {
    return NextResponse.json({ error: 'Not the report owner' }, { status: 403 })
  }

  return NextResponse.json({ uuid, token: signShareToken(uuid) })
}
