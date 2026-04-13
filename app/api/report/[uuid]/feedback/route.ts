import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { addressKey } from '@/lib/addressKey'
import { getCurrentCustomer } from '@/lib/entitlements'

// Submit feedback on a specific report. Stored under the normalized address
// key so subsequent reports for the SAME property inherit the flag history —
// if two different buyers both say "value looks off" on 1324 Bradley Dr, the
// third buyer sees a warning banner before paying.

const VALID_VERDICTS = new Set(['ok', 'value_off', 'rent_off', 'both_off'])

export async function POST(
  req: NextRequest,
  { params }: { params: { uuid: string } }
) {
  try {
    const body = await req.json().catch(() => null)
    const verdict = body?.verdict
    if (!verdict || !VALID_VERDICTS.has(verdict)) {
      return NextResponse.json({ error: 'Invalid verdict' }, { status: 400 })
    }

    const report = await prisma.report.findUnique({ where: { id: params.uuid } })
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    const customer = await getCurrentCustomer()

    await prisma.reportFeedback.create({
      data: {
        reportId: report.id,
        addressKey: addressKey(report.address),
        verdict,
        customerId: customer?.id,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[feedback] error', err?.message)
    return NextResponse.json(
      { error: 'Feedback submission failed' },
      { status: 500 }
    )
  }
}

// Returns aggregate flags for the given report's address. Used by the UI
// to decide whether to display the "flagged by previous buyers" banner.
export async function GET(
  _req: NextRequest,
  { params }: { params: { uuid: string } }
) {
  const report = await prisma.report.findUnique({
    where: { id: params.uuid },
    select: { address: true },
  })
  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }
  const key = addressKey(report.address)
  const all = await prisma.reportFeedback.findMany({
    where: { addressKey: key },
    select: { verdict: true },
  })
  const counts = {
    total: all.length,
    ok: all.filter((f) => f.verdict === 'ok').length,
    value_off: all.filter((f) => f.verdict === 'value_off' || f.verdict === 'both_off').length,
    rent_off: all.filter((f) => f.verdict === 'rent_off' || f.verdict === 'both_off').length,
  }
  return NextResponse.json(counts)
}
