import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: { uuid: string } }
) {
  try {
    const { uuid } = params

    const report = await prisma.report.findUnique({
      where: { id: uuid },
    })

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    return NextResponse.json({
      id: report.id,
      address: report.address,
      city: report.city,
      state: report.state,
      paid: report.paid,
      teaserData: report.teaserData,
      fullReportData: report.fullReportData,
      createdAt: report.createdAt,
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'DB error', debug: err?.message }, { status: 500 })
  }
}
