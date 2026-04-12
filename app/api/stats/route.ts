import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Aggregate real usage stats — used for the live counter on the landing page.
// Cached via Next.js `revalidate: 60` so we don't hammer the DB on every page load.
export const revalidate = 60

export async function GET() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const [totalReports, paidReports, reportsThisWeek] = await Promise.all([
      prisma.report.count(),
      prisma.report.count({ where: { paid: true } }),
      prisma.report.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    ])

    return NextResponse.json({
      totalReports,
      paidReports,
      reportsThisWeek,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Stats unavailable', totalReports: 0, paidReports: 0, reportsThisWeek: 0 },
      { status: 200 } // fail soft — landing page still renders
    )
  }
}
