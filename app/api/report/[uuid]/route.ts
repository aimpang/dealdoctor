import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateFullReport } from '@/lib/reportGenerator'
import { CUSTOMER_COOKIE, setCustomerCookie } from '@/lib/entitlements'
import { addressKey } from '@/lib/addressKey'
import { logger } from '@/lib/logger'
import { resolveReportAccess } from '@/lib/report-access'

// Single-process in-flight tracker. Keys are report UUIDs; values are the
// promise of the in-flight generateFullReport. Concurrent requests for the
// same UUID share the same promise, so Sonnet is only called once.
const generationsInFlight = new Map<string, Promise<unknown>>()
function withGenerationLock<T>(uuid: string, fn: () => Promise<T>): Promise<T> {
  const existing = generationsInFlight.get(uuid)
  if (existing) {
    console.log(`[api/report] reusing in-flight generation for ${uuid}`)
    return existing as Promise<T>
  }
  const promise = fn().finally(() => {
    generationsInFlight.delete(uuid)
  })
  generationsInFlight.set(uuid, promise)
  return promise
}

export async function GET(
  req: NextRequest,
  { params }: { params: { uuid: string } }
) {
  const { uuid } = params
  try {
    const searchParams = req.nextUrl.searchParams

    // Debug bypass — dev-only, AND requires a secondary secret match. Both
    // the NODE_ENV gate and the secret gate must pass, so a leaked NODE_ENV
    // toggle alone can't expose paid content (see lib/debugAccess.ts).
    let report = await prisma.report.findUnique({ where: { id: uuid } })
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Short-circuit on a cached reviewer block. When composeFullReport throws
    // "Review blocked: ...", generateFullReport persists a sentinel to
    // fullReportData so we don't re-run the 30-60s pipeline on every poll.
    if (report.fullReportData) {
      try {
        const parsed = JSON.parse(report.fullReportData)
        if (parsed && parsed.__error === 'quality-blocked') {
          return NextResponse.json(
            {
              error: 'This report was blocked by our quality gate.',
              code: 'quality-blocked',
              reason: parsed.reason,
              blockedAt: parsed.at,
              audit: parsed.audit ?? null,
              uuid,
            },
            { status: 502 }
          )
        }
        if (parsed && parsed.__error === 'invariant-blocked') {
          return NextResponse.json(
            {
              error: 'This report failed an internal math sanity check.',
              code: 'report-invariant-failed',
              reason: parsed.reason,
              blockedAt: parsed.at,
              failures: Array.isArray(parsed.failures) ? parsed.failures : [],
              uuid,
            },
            { status: 502 }
          )
        }
        if (parsed && parsed.__error === 'review-blocked') {
          return NextResponse.json(
            {
              error: 'This report was blocked by our internal quality review.',
              code: 'review-blocked',
              reason: parsed.reason,
              blockedAt: parsed.at,
              uuid,
            },
            { status: 502 }
          )
        }
      } catch {
        // Non-JSON fullReportData falls through to the normal response path.
      }
    }

    const access = await resolveReportAccess({
      allowDebug: true,
      cookieAccessToken: req.cookies.get(CUSTOMER_COOKIE)?.value,
      debugKey: searchParams.get('debugKey'),
      debugRequested: searchParams.get('debug') === '1',
      reportCustomerId: (report as any).customerId,
      reportId: uuid,
      tokenCandidate: searchParams.get('t'),
    })
    const isDebug = access.isDebug

    // In debug mode, synthesize the full report if it hasn't been generated yet.
    // Hard 3-minute timeout so a stuck Rentcast fetch can't freeze the route
    // indefinitely (Houston / Baltimore addresses from the batch pressure
    // test hung with no user-facing error).
    if (isDebug && !report.fullReportData) {
      const REPORT_GEN_TIMEOUT_MS = 3 * 60_000
      try {
        // In-flight mutex: when multiple concurrent requests land on the same
        // UUID (report page mounts, retries, QA app bursts), they all see
        // fullReportData: null and would each fire a fresh generateFullReport
        // — duplicating Sonnet narrative cost 5-10× per user report. Dedupe
        // by caching the in-flight promise keyed on UUID. Second request
        // awaits the first; a third reads the already-persisted row from the
        // refetch below. Single-process scope (good enough for Vercel's per-
        // invocation isolation; use a DB row lock or Redis for multi-instance).
        await withGenerationLock(uuid, () =>
          Promise.race([
            generateFullReport(uuid),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('report-generation-timeout')), REPORT_GEN_TIMEOUT_MS)
            ),
          ])
        )
      } catch (err: any) {
        if (err?.message === 'report-generation-timeout') {
          return NextResponse.json(
            {
              error: 'Report generation timed out — the property data provider may be slow. Please try again.',
              code: 'report-generation-timeout',
              uuid,
            },
            { status: 504 }
          )
        }
        // Invariant gate contradiction — the math contradicted itself and
        // we blocked the report rather than ship garbage to the buyer.
        if (err?.name === 'InvariantGateError') {
          return NextResponse.json(
            {
              error: 'This report failed an internal math sanity check. Our team has been notified. Please try a different address or try again shortly.',
              code: 'report-invariant-failed',
              uuid,
              failures: (err.failures ?? []).map((f: { code: string; message: string; actual?: string; expected?: string }) => ({
                code: f.code,
                message: f.message,
                actual: f.actual,
                expected: f.expected,
              })),
            },
            { status: 502 }
          )
        }
        if (err?.name === 'QualityAuditError') {
          return NextResponse.json(
            {
              error: 'This report was blocked by our quality gate.',
              code: 'quality-blocked',
              uuid,
              reason: err?.audit?.summary ?? err?.message,
              audit: err?.audit ?? null,
            },
            { status: 502 }
          )
        }
        throw err
      }
      report = await prisma.report.findUnique({ where: { id: uuid } })
    }

    if (!report) {
      return NextResponse.json({ error: 'Report disappeared' }, { status: 500 })
    }

    const r = report as any

    // Access gating for fullReportData. Three paths grant full access:
    //   (a) Owner: session cookie matches report.customerId
    //   (b) Signed share link: ?t=<hmac> validates against the UUID
    //   (c) Debug bypass (dev only + secret)
    // Anyone else gets teaser-only. This closes the "UUID-in-a-forwarded-
    // email = permanent paid access" leak without breaking owners' bookmarks.
    const hasFullAccess = access.hasAccess
    const tokenRevokedByRefund = access.tokenRevokedByRefund
    // Refunded customers retain access to their OWN past reports (standard
    // SaaS behavior — they paid for a moment-in-time analysis and keep it)
    // but their shared links (?t=) are invalidated below.

    // When the report's owning customer has been refunded, shared links
    // (?t=) no longer grant full access. Owner access via cookie is
    // preserved — we're revoking distribution, not the buyer's own view.

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
      // Tell the client WHY they're seeing (or not seeing) full data so the
      // UI can render a "ask the owner for a share link" CTA on the teaser
      // path instead of the generic paywall.
      accessGrantedVia: access.accessGrantedVia,
      restricted: !hasFullAccess && report.paid,
      tokenRevokedByRefund,
      teaserData: report.teaserData,
      // fullReportData is withheld from non-owner, non-tokenized access even
      // when the report itself is paid. Owners bookmark /report/<uuid>; they
      // have the cookie and still see everything. Recipients of a forwarded
      // raw URL see only the teaser.
      fullReportData: hasFullAccess ? report.fullReportData : null,
      photoFindings: hasFullAccess ? r.photoFindings ?? null : null,
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
    logger.error('report.fetch_failed', { uuid, error: err })
    return NextResponse.json(
      {
        error: 'Report generation failed',
        ...(process.env.NODE_ENV !== 'production' ? { debug: err?.message } : {}),
      },
      { status: 500 }
    )
  }
}
