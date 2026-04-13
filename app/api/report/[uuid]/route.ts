import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateFullReport } from '@/lib/reportGenerator'
import { CUSTOMER_COOKIE, setCustomerCookie } from '@/lib/entitlements'
import { addressKey } from '@/lib/addressKey'

export async function GET(
  req: NextRequest,
  { params }: { params: { uuid: string } }
) {
  try {
    const { uuid } = params
    const { searchParams } = new URL(req.url)

    // Dev-only debug bypass — lets us view a full report without paying.
    // Both gates required: NODE_ENV must NOT be production AND ?debug=1 must be
    // explicitly passed. Belt-and-suspenders so this can never slip into prod.
    const isDebug =
      process.env.NODE_ENV !== 'production' && searchParams.get('debug') === '1'

    let report = await prisma.report.findUnique({ where: { id: uuid } })
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // In debug mode, synthesize the full report if it hasn't been generated yet.
    if (isDebug && !report.fullReportData) {
      await generateFullReport(uuid)
      report = await prisma.report.findUnique({ where: { id: uuid } })
    }

    if (!report) {
      return NextResponse.json({ error: 'Report disappeared' }, { status: 500 })
    }

    const r = report as any

    // Aggregate feedback across ALL reports for this same address. If enough
    // past buyers flagged the value/rent, we surface a warning banner.
    const key = addressKey(report.address)
    const allFeedback = await prisma.reportFeedback.findMany({
      where: { addressKey: key },
      select: { verdict: true },
    })
    const addressFlags = {
      total: allFeedback.length,
      ok: allFeedback.filter((f) => f.verdict === 'ok').length,
      value_off: allFeedback.filter(
        (f) => f.verdict === 'value_off' || f.verdict === 'both_off'
      ).length,
      rent_off: allFeedback.filter(
        (f) => f.verdict === 'rent_off' || f.verdict === 'both_off'
      ).length,
    }

    const response = NextResponse.json({
      id: report.id,
      address: report.address,
      city: report.city,
      state: report.state,
      paid: isDebug ? true : report.paid, // debug: pretend it's paid so UI renders
      debug: isDebug,                     // flag so UI can show a banner
      teaserData: report.teaserData,
      fullReportData: report.fullReportData,
      photoFindings: r.photoFindings ?? null,
      addressFlags,
      createdAt: report.createdAt,
    })

    // When the buyer lands on /report/[uuid]?success=true after LemonSqueezy
    // checkout, set the customer cookie so subsequent reports flow through the
    // entitlement system. Only fires if: (a) success=true param is present,
    // (b) report is paid, (c) report is linked to a customer, (d) no cookie
    // already set. Once set, the user's 5-pack / Unlimited quota applies
    // automatically on their next preview search.
    const success = searchParams.get('success') === 'true'
    const existingCookie = req.cookies.get(CUSTOMER_COOKIE)?.value
    if (success && report.paid && r.customerId && !existingCookie) {
      const customer = await prisma.customer.findUnique({
        where: { id: r.customerId },
        select: { accessToken: true },
      })
      if (customer?.accessToken) {
        setCustomerCookie(response, customer.accessToken)
      }
    }

    return response
  } catch (err: any) {
    // The outer catch covers anything — DB, AI, network, climate lookup, etc.
    // "DB error" as a label was misleading; upstream bubbles up the real message.
    return NextResponse.json(
      { error: 'Report generation failed', debug: err?.message },
      { status: 500 }
    )
  }
}
