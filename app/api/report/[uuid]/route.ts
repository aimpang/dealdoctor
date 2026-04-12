import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateFullReport } from '@/lib/reportGenerator'

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
    return NextResponse.json({
      id: report.id,
      address: report.address,
      city: report.city,
      state: report.state,
      paid: isDebug ? true : report.paid, // debug: pretend it's paid so UI renders
      debug: isDebug,                     // flag so UI can show a banner
      teaserData: report.teaserData,
      fullReportData: report.fullReportData,
      photoFindings: r.photoFindings ?? null,
      createdAt: report.createdAt,
    })
  } catch (err: any) {
    // The outer catch covers anything — DB, AI, network, climate lookup, etc.
    // "DB error" as a label was misleading; upstream bubbles up the real message.
    return NextResponse.json(
      { error: 'Report generation failed', debug: err?.message },
      { status: 500 }
    )
  }
}
