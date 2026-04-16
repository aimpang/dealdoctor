import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateDealDoctor } from '@/lib/dealDoctor'
import type { ClimateAndInsurance } from '@/lib/climateRisk'
import { CUSTOMER_COOKIE } from '@/lib/entitlements'
import { verifyShareToken } from '@/lib/shareToken'
import { rateLimit } from '@/lib/rateLimit'
import { runReviewLoop, type ReviewConcern } from '@/lib/reviewReport'
import { logger } from '@/lib/logger'
import { resolveReportAccess } from '@/lib/report-access'

/**
 * Re-run the Claude "Deal Doctor" narration for a report that was generated
 * while the Anthropic API was failing (credit exhaustion, network, etc). We
 * rebuild the call from data already persisted in `fullReportData`, so no
 * Rentcast/Mapbox/FEMA quota is spent — only the AI call is retried.
 *
 * Access gating mirrors /api/report/[uuid]: owner cookie matching
 * report.customerId, OR a valid signed share token (?t=). Otherwise 403 —
 * otherwise any caller who knows a UUID could burn unlimited Anthropic calls.
 *
 * Idempotent: if the retry succeeds we update fullReportData with the new
 * dealDoctor + clear the error; if the retry also fails we update the
 * captured error detail so ops can diagnose. Safe to call multiple times.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { uuid: string } }
) {
  const { uuid } = params

  // Auth-first: do stateless share-token verification and cookie-based owner
  // resolution before any report read, so an unauthenticated caller can't
  // distinguish "UUID exists" from "UUID unknown" (response is always 403).
  const tokenParam = req.nextUrl.searchParams.get('t')
  const tokenValid = verifyShareToken(uuid, tokenParam)
  const cookieToken = req.cookies.get(CUSTOMER_COOKIE)?.value
  const cookieCustomer = cookieToken
    ? await prisma.customer.findUnique({
        where: { accessToken: cookieToken },
        select: { id: true },
      })
    : null

  const report = await prisma.report.findUnique({ where: { id: uuid } })
  if (!report) {
    if (!cookieCustomer && !tokenValid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Report not ready' }, { status: 404 })
  }

  const access = await resolveReportAccess({
    cookieAccessToken: cookieToken,
    reportCustomerId: (report as any).customerId,
    reportId: uuid,
    resolvedCookieCustomerId: cookieCustomer?.id ?? null,
    resolvedTokenValid: tokenValid,
    tokenCandidate: tokenParam,
  })

  if (!access.isOwner && !access.effectiveTokenValid) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!report.fullReportData) {
    return NextResponse.json({ error: 'Report not ready' }, { status: 404 })
  }

  // Cap Anthropic retry cost per report: 10/hour. Each retry burns a paid
  // Sonnet call and writes to the DB; 10/hr is generous for a legitimate
  // user debugging a failed generation but blocks a hostile loop.
  if (await rateLimit(uuid, 10, { bucket: 'retry-ai', windowMs: 60 * 60 * 1000 })) {
    return NextResponse.json(
      { error: 'Too many AI retries for this report. Try again in an hour.' },
      { status: 429 }
    )
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

  // Invariant WARN flags persisted by the main pipeline. Forwarded into
  // the prompt so a retried narration is bound by the same deterministic
  // constraints as the original — otherwise a retry silently regenerates
  // with looser guardrails than the first pass.
  const invariantWarnings = Array.isArray(data.invariantWarnings)
    ? data.invariantWarnings
    : undefined

  // Closure mirrors the pattern in composeFullReport so the initial retry
  // call and the reviewer-triggered rewrite pass stay in lock-step. Only
  // `reviewCorrections` varies.
  const runGenerator = (reviewCorrections?: ReviewConcern[]) =>
    generateDealDoctor(
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
      property.rehabBudget || undefined,
      undefined, // canonicalBreakEvenPrice — not persisted in fullReportData under a stable key
      property.property_type ?? null,
      property.year_built ?? null,
      property.square_feet ?? null,
      undefined, // strProhibited — not persisted
      undefined, // strNetMonthlyCashFlow — not persisted
      reviewCorrections,
      invariantWarnings
    )

  try {
    let dealDoctor = await runGenerator()

    // Reviewer pass — same guardrails as composeFullReport.
    let originalDealDoctor: typeof dealDoctor | null = null
    const loopResult = await runReviewLoop(
      data as Record<string, unknown>,
      dealDoctor as unknown as Record<string, unknown>,
      async (concerns) => {
        originalDealDoctor = dealDoctor
        const rewritten = await runGenerator(concerns)
        return rewritten as unknown as Record<string, unknown>
      },
      { maxRounds: 2, confidenceFloor: 0.80 }
    )

    if (loopResult.outcome.blocked) {
      logger.error('retryAi.review_blocked', {
        uuid,
        summary: loopResult.outcome.finalSummary,
        concernCount: loopResult.outcome.finalConcerns.length,
      })
      return NextResponse.json(
        { ok: false, detail: `Review blocked: ${loopResult.outcome.finalSummary}` },
        { status: 502 }
      )
    }

    dealDoctor = loopResult.narrative as unknown as typeof dealDoctor
    // Full per-round history preserved — see composeFullReport reviewOutcome
    // notes on why low-confidence + round-1 concerns matter for training.
    const reviewOutcome = {
      rounds: loopResult.outcome.rounds,
      verdict: loopResult.outcome.finalVerdict,
      confidence: loopResult.outcome.finalConfidence,
      concerns: loopResult.outcome.finalConcerns,
      summary: loopResult.outcome.finalSummary,
      rewrote: originalDealDoctor !== null,
      originalDealDoctor,
      history: loopResult.outcome.history,
    }

    logger.info('retryAi.review_complete', {
      uuid,
      rounds: loopResult.outcome.rounds,
      verdict: loopResult.outcome.finalVerdict,
      confidence: loopResult.outcome.finalConfidence,
      concernCount: loopResult.outcome.finalConcerns.length,
      concernsPerRound: loopResult.outcome.history.map((h) => h.concerns.length),
      reviewerErrored: loopResult.outcome.history.some((h) => !!h.error),
      rewrote: originalDealDoctor !== null,
    })

    // Write back — same fullReportData shape, dealDoctor populated + errors cleared + reviewOutcome attached.
    const updated = {
      ...data,
      dealDoctor,
      dealDoctorError: null,
      dealDoctorErrorDetail: null,
      reviewOutcome,
    }
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
