import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { searchProperty } from '@/lib/propertyApi'

// Manually-triggered backtest. Samples N recent paid reports, re-fetches the
// current Rentcast AVM for each address, and compares what we predicted at
// report-generation time vs what the current AVM says. Not ground-truth
// accuracy (we don't have actual sale data for most properties) — but does
// tell us whether our predictions drift badly over time, which is the main
// way AVM-based tools silently mislead.
//
// Protected by ADMIN_KEY env var (header: X-Admin-Key). Not exposed via UI;
// triggered via curl / scheduled cron / manual run.
//
// Cron setup: Railway doesn't have built-in cron but you can run this monthly
// via a simple shell on your machine, or via a third-party cron service that
// hits the URL.

export const maxDuration = 60 // give it time to fetch many properties

const SAMPLE_SIZE = 30

export async function POST(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY
  const provided = req.headers.get('X-Admin-Key')
  if (!adminKey || provided !== adminKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Sample paid reports with generated fullReportData — skip if none
  const reports = await prisma.report.findMany({
    where: {
      paid: true,
      fullReportData: { not: null },
    },
    orderBy: { paidAt: 'desc' },
    take: SAMPLE_SIZE,
  })

  if (reports.length === 0) {
    return NextResponse.json(
      { error: 'No paid reports available to backtest' },
      { status: 400 }
    )
  }

  const valueErrors: number[] = []
  let skipped = 0

  for (const r of reports) {
    try {
      const full = JSON.parse(r.fullReportData!)
      const predictedValue = Number(full?.property?.askPrice)
      const predictedRent = Number(
        full?.inputs?.monthlyRent ??
          (full?.ltr?.noiAnnual ? full.ltr.noiAnnual / 12 + (full.expenses?.monthlyTotal ?? 0) : 0)
      )
      if (!Number.isFinite(predictedValue) || predictedValue <= 0) {
        skipped++
        continue
      }

      // Re-fetch current data for the same address
      const currentProp = await searchProperty(r.address)
      if (!currentProp) {
        skipped++
        continue
      }

      const currentValue = currentProp.estimated_value
      if (currentValue > 0) {
        valueErrors.push(Math.abs(predictedValue - currentValue) / currentValue)
      }
      // Rent backtesting deferred to v2 — requires a second API round-trip
      // per sample and rents are much noisier month-to-month than values.
      void predictedRent
    } catch {
      skipped++
    }
  }

  if (valueErrors.length === 0) {
    return NextResponse.json(
      { error: 'No usable samples — all reports skipped' },
      { status: 400 }
    )
  }

  // Compute metrics
  valueErrors.sort((a, b) => a - b)
  const valueMedianErr = valueErrors[Math.floor(valueErrors.length / 2)]
  const valueWithin10 = valueErrors.filter((e) => e <= 0.1).length / valueErrors.length

  const run = await prisma.backtestRun.create({
    data: {
      sampleSize: valueErrors.length,
      valueMedianErr,
      valueWithin10,
      notes: skipped > 0 ? `Skipped ${skipped} (missing data or re-fetch failed)` : null,
    },
  })

  return NextResponse.json({
    ok: true,
    run: {
      id: run.id,
      runAt: run.runAt,
      sampleSize: run.sampleSize,
      valueMedianErr: run.valueMedianErr,
      valueWithin10: run.valueWithin10,
    },
  })
}

// GET: returns latest backtest run for /methodology page
export async function GET() {
  const latest = await prisma.backtestRun.findFirst({
    orderBy: { runAt: 'desc' },
  })
  if (!latest) {
    return NextResponse.json({ run: null })
  }
  return NextResponse.json({
    run: {
      runAt: latest.runAt,
      sampleSize: latest.sampleSize,
      valueMedianErr: latest.valueMedianErr,
      valueWithin10: latest.valueWithin10,
      notes: latest.notes,
    },
  })
}
