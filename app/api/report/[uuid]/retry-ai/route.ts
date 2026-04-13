import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateDealDoctor } from '@/lib/dealDoctor'
import type { ClimateAndInsurance } from '@/lib/climateRisk'

/**
 * Re-run the Claude "Deal Doctor" narration for a report that was generated
 * while the Anthropic API was failing (credit exhaustion, network, etc). We
 * rebuild the call from data already persisted in `fullReportData`, so no
 * Rentcast/Mapbox/FEMA quota is spent — only the AI call is retried.
 *
 * Idempotent: if the retry succeeds we update fullReportData with the new
 * dealDoctor + clear the error; if the retry also fails we update the
 * captured error detail so ops can diagnose. Safe to call multiple times.
 */
export async function POST(
  _req: Request,
  { params }: { params: { uuid: string } }
) {
  const { uuid } = params
  const report = await prisma.report.findUnique({ where: { id: uuid } })
  if (!report || !report.fullReportData) {
    return NextResponse.json({ error: 'Report not ready' }, { status: 404 })
  }

  let data: any
  try {
    data = JSON.parse(report.fullReportData)
  } catch {
    return NextResponse.json({ error: 'Report data corrupt' }, { status: 500 })
  }

  // Nothing to retry — AI narration is already present.
  if (data.dealDoctor) {
    return NextResponse.json({ ok: true, alreadyPresent: true })
  }

  // Extract everything generateDealDoctor needs. These fields are all written
  // by reportGenerator into fullReportData, so this mirrors that shape.
  const property = data.property || {}
  const rates = data.rates || {}
  const inputs = data.inputs || {}
  const ltr = data.ltr
  const offerPrice = property.offerPrice ?? property.askPrice
  const monthlyRent = inputs.monthlyRent ?? data.monthlyRent
  const investorRate = rates.mortgage30yrInvestor
  const climate: ClimateAndInsurance | undefined = data.climate || undefined
  const bedrooms = property.bedrooms
  const comps = Array.isArray(data.comparableSales) ? data.comparableSales : []
  const compValues = comps
    .map((c: any) => Number(c.estimated_value))
    .filter((v: number) => Number.isFinite(v) && v > 0)
    .sort((a: number, b: number) => a - b)
  const arvEstimate =
    compValues.length > 0 ? compValues[Math.floor(compValues.length / 2)] : undefined

  if (!ltr || !offerPrice || !monthlyRent || !investorRate) {
    return NextResponse.json(
      { error: 'Report missing required metrics for AI retry' },
      { status: 400 }
    )
  }

  try {
    const dealDoctor = await generateDealDoctor(
      property.address,
      property.city,
      property.state,
      (property.strategy as 'LTR' | 'STR' | 'FLIP') || 'LTR',
      ltr,
      offerPrice,
      monthlyRent,
      investorRate,
      climate,
      bedrooms,
      arvEstimate,
      property.rehabBudget || undefined
    )
    // Write back — same fullReportData shape, dealDoctor populated + errors cleared.
    const updated = { ...data, dealDoctor, dealDoctorError: null, dealDoctorErrorDetail: null }
    await prisma.report.update({
      where: { id: uuid },
      data: { fullReportData: JSON.stringify(updated) },
    })
    return NextResponse.json({ ok: true, retried: true })
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status
    const detail = [
      err?.constructor?.name,
      status ? `status=${status}` : null,
      err?.message,
      err?.error ? JSON.stringify(err.error) : null,
    ]
      .filter(Boolean)
      .join(' · ')
    const updated = { ...data, dealDoctorErrorDetail: detail }
    await prisma.report.update({
      where: { id: uuid },
      data: { fullReportData: JSON.stringify(updated) },
    })
    return NextResponse.json({ ok: false, detail }, { status: 502 })
  }
}
