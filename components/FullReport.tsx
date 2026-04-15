'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { DealDoctorSection } from './DealDoctor'
import { WealthAreaChart, WealthCompositionPie, SensitivityTornado } from './ReportCharts'
import { RehabEstimator } from './RehabEstimator'
import { PortfolioButton } from './PortfolioButton'
import { PropertyViews } from './PropertyViews'
import { ShareButton } from './ShareButton'
import {
  CheckCircle2Icon,
  XCircleIcon,
  MinusCircleIcon,
  TrendingUpIcon,
  AlertTriangleIcon,
  PrinterIcon,
  TargetIcon,
  ActivityIcon,
  DownloadIcon,
  EyeOffIcon,
  EyeIcon,
  BarChart3Icon,
  RefreshCwIcon,
} from 'lucide-react'

interface FullReportProps {
  data: any
  uuid?: string
  addressFlags?: {
    total: number
    ok: number
    value_off: number
    rent_off: number
  }
}

/* ───── Formatters ───── */
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
const pct = (n: number, d = 2) => `${(n * 100).toFixed(d)}%`

/* ───── Verdict config ───── */
const VERDICT = {
  DEAL: {
    label: 'Strong Deal',
    color: 'text-emerald-700 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    Icon: CheckCircle2Icon,
  },
  MARGINAL: {
    label: 'Marginal',
    color: 'text-amber-700 dark:text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    Icon: MinusCircleIcon,
  },
  PASS: {
    label: 'Pass',
    color: 'text-red-700 dark:text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    Icon: XCircleIcon,
  },
} as const

export function FullReport({ data, uuid, addressFlags }: FullReportProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const isLenderView = searchParams.get('view') === 'lender'

  // Lender-ready view hides assumptions an underwriter wouldn't underwrite on:
  // appreciation-driven wealth projections, tax shields that depend on personal
  // tax posture, STR revenue potential, and the rehab estimator.
  const hideInLenderView = (section: 'str' | 'rehab' | 'composition' | 'tax' | 'wealthHero') =>
    isLenderView && ['str', 'rehab', 'composition', 'tax', 'wealthHero'].includes(section)

  const toggleLenderView = () => {
    const params = new URLSearchParams(searchParams.toString())
    if (isLenderView) params.delete('view')
    else params.set('view', 'lender')
    const qs = params.toString()
    router.push(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }
  const {
    property,
    rates,
    ltr,
    dealDoctor,
    dealDoctorError,
    comparableSales,
    stateRules,
    breakeven,
    climate,
    expenses,
    cashToClose,
    wealthProjection,
    financingAlternatives,
    sensitivity,
    recommendedOffers,
    strProjection,
    marketSnapshot,
    locationSignals,
    rentComps,
    valueTriangulation,
    rentWarnings,
    warnings,
    crossCheckLinks,
  } = data

  const v = VERDICT[ltr.verdict as keyof typeof VERDICT] || VERDICT.PASS

  // Sync document.title client-side so the browser's "Save as PDF" dialog
  // picks up the property address — e.g. "Deal Doctor - 412 N Main St,
  // Blacksburg, VA". The root app/layout.tsx is a Client Component with a
  // hardcoded <title> that overrides App Router's generateMetadata on the
  // report route, so without this effect the PDF filename reverts to the
  // generic marketing string. Address-based title wins on hydration.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const addr = property?.address
    const city = property?.city
    const st = property?.state
    if (!addr) return
    const tail = [city, st].filter(Boolean).join(', ')
    document.title = tail
      ? `Deal Doctor - ${addr}, ${tail}`
      : `Deal Doctor - ${addr}`
  }, [property?.address, property?.city, property?.state])

  return (
    <div className="w-full">
      {/* Print-only branded header — screen users see the nav logo instead */}
      <div className="print-only mb-4 border-b border-border pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg width="36" height="18" viewBox="0 0 64 32" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 22 L18 22 M46 22 L64 22" stroke="#18181b" strokeOpacity="0.35" strokeWidth="1.8" strokeLinecap="round" fill="none" />
              <path d="M18 22 L22 26 L32 6 L42 26 L46 22" stroke="#18181b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <circle cx="32" cy="6" r="2.5" fill="#f97316" />
            </svg>
            <span className="font-[family-name:var(--font-playfair)] text-sm font-bold tracking-tight">
              Deal<span style={{ color: '#f97316' }}>Doctor</span>
            </span>
          </div>
          <div className="text-right text-[9px] text-muted-foreground">
            <p className="font-semibold uppercase tracking-wider">Investment Report</p>
            {data.generatedAt && (
              <p>Generated {new Date(data.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
            )}
          </div>
        </div>
      </div>

      {/* Top utility bar — all hidden in print */}
      <div className="no-print mb-3 flex flex-wrap items-center justify-end gap-2">
        {uuid && <ShareButton uuid={uuid} address={property?.address ?? ''} />}
        {uuid && (
          <PortfolioButton
            deal={{
              uuid,
              address: property?.address ?? '',
              cityState: `${property?.city ?? ''}, ${property?.state ?? ''}`,
              verdict: ltr?.verdict,
              dealScore: ltr?.dealScore,
              offer: property?.offerPrice ?? property?.askPrice,
              breakevenDelta: breakeven?.delta,
              fiveYrWealth: wealthProjection?.hero?.totalWealthBuilt5yr,
              fiveYrIRR: wealthProjection?.hero?.irr5yr,
            }}
          />
        )}

        {uuid && (
          <a
            // Preserve the dev debug flag so the export route skips the paid check
            // in local dev. Never surfaces in prod (NODE_ENV-gated on the server).
            href={`/api/report/${uuid}/export${searchParams.get('debug') === '1' ? '?debug=1' : ''}`}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            Export Excel
          </a>
        )}

        <button
          onClick={toggleLenderView}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
            isLenderView
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
          aria-pressed={isLenderView}
        >
          {isLenderView ? (
            <>
              <EyeIcon className="h-3.5 w-3.5" />
              Full analysis view
            </>
          ) : (
            <>
              <EyeOffIcon className="h-3.5 w-3.5" />
              Lender-ready view
            </>
          )}
        </button>

        <button
          onClick={() => {
            if (typeof window === 'undefined') return
            // Re-apply the per-report title right before printing so the
            // browser's PDF filename is "Deal Doctor - {address}" even if
            // the root layout's hardcoded title happened to re-run.
            const addr = property?.address
            const tail = [property?.city, property?.state].filter(Boolean).join(', ')
            if (addr) {
              document.title = tail ? `Deal Doctor - ${addr}, ${tail}` : `Deal Doctor - ${addr}`
            }
            window.print()
          }}
          className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PrinterIcon className="h-3.5 w-3.5" />
          Print / Save PDF
        </button>
      </div>

      {/* Address-level flag banner: if ≥2 previous buyers flagged value or
          rent as "off" for THIS property, surface a prominent warning.
          Protects the fifth buyer from the same bad data that caught the
          first two. Doesn't block the report — just warns. */}
      {addressFlags &&
        (addressFlags.value_off >= 2 || addressFlags.rent_off >= 2) && (
          <div className="mb-4 rounded-md border-2 border-red-500/40 bg-red-500/5 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Previous buyers flagged this property
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {addressFlags.value_off >= 2 && (
                    <>
                      <span className="font-medium text-foreground">
                        {addressFlags.value_off}
                      </span>{' '}
                      past buyers reported the value estimate as inaccurate.
                    </>
                  )}
                  {addressFlags.value_off >= 2 && addressFlags.rent_off >= 2 && ' · '}
                  {addressFlags.rent_off >= 2 && (
                    <>
                      <span className="font-medium text-foreground">
                        {addressFlags.rent_off}
                      </span>{' '}
                      past buyers reported the rent estimate as inaccurate.
                    </>
                  )}
                  {' '}Treat those numbers with extra caution and verify with a local
                  agent before relying on them.
                </p>
              </div>
            </div>
          </div>
        )}

      {/* Lender-view banner */}
      {isLenderView && (
        <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5 text-xs">
          <p className="font-semibold text-foreground">Lender-ready view active.</p>
          <p className="mt-0.5 text-muted-foreground">
            STR projections, rehab value-add estimator, tax shield benefits, and
            appreciation-dependent sections are hidden. DSCR, cash flow, sensitivity,
            financing alternatives, and comps remain — the numbers an underwriter will
            actually touch.
          </p>
        </div>
      )}

      {/* Property header strip */}
      <header className="mb-5 border-b border-border pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <Eyebrow>Property Report</Eyebrow>
            <h1 className="mt-0.5 font-[family-name:var(--font-playfair)] text-2xl font-bold leading-tight text-foreground sm:text-3xl">
              {property.address}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {property.city}, {property.state}
              <Dot />
              {property.propertyType}
              <Dot />
              {property.bedrooms === 0
                ? `Studio / ${property.bathrooms}ba`
                : `${property.bedrooms}bd / ${property.bathrooms}ba`}
              {property.sqft && (
                <>
                  <Dot />
                  {property.sqft.toLocaleString()} sqft
                </>
              )}
              {property.yearBuilt && (
                <>
                  <Dot />
                  Built {property.yearBuilt}
                </>
              )}
            </p>
          </div>

          <div
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2',
              v.bg,
              v.border
            )}
          >
            <v.Icon className={cn('h-5 w-5', v.color)} />
            <div className="leading-tight">
              <p className={cn('text-sm font-bold uppercase tracking-wide', v.color)}>
                {v.label}
              </p>
              <p className="text-[10px] text-muted-foreground">Score {ltr.dealScore}/100</p>
            </div>
          </div>
        </div>
      </header>

      {/* Property visual context — aerial + street maps. We can't pull MLS
          listing photos without a broker license; aerial/street context is
          what's actually useful for diligence anyway. */}
      {property?.latitude != null && property?.longitude != null && (
        <section className="mb-5">
          <PropertyViews
            address={property.address}
            city={property.city}
            state={property.state}
            lat={property.latitude}
            lng={property.longitude}
          />
        </section>
      )}

      {/* Hero 3-card strip — the three numbers that matter most */}
      <section className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {breakeven && (
          <HeroCell
            label="Offer vs Breakeven"
            value={
              breakeven.nearBreakeven ? (
                <span className="text-muted-foreground text-lg">Neutral at ask</span>
              ) : breakeven.delta < 0 ? (
                <span className="text-red-700 dark:text-red-400">
                  +{fmt(-breakeven.delta)}
                </span>
              ) : (
                <span className="text-emerald-700 dark:text-emerald-400">
                  −{fmt(breakeven.delta)}
                </span>
              )
            }
            sub={
              breakeven.nearBreakeven
                ? `Cash-flow neutral at market price (${fmt(breakeven.yourOffer)})`
                : `Offer ${fmt(breakeven.yourOffer)}  ·  BE ${fmt(breakeven.price)}`
            }
          />
        )}
        {wealthProjection && (
          <HeroCell
            label="5-Year Wealth Built"
            value={<span className="text-primary">{fmt(wealthProjection.hero.totalWealthBuilt5yr)}</span>}
            sub="Cash flow + paydown + appreciation + tax shield"
          />
        )}
        {wealthProjection && (
          <HeroCell
            label="5-Year Hold IRR"
            value={
              <span>
                {Number.isFinite(wealthProjection.hero.irr5yr)
                  ? `${(wealthProjection.hero.irr5yr * 100).toFixed(1)}%`
                  : 'N/A'}
              </span>
            }
            sub="Incl. sale at Y5 (6% selling costs)"
          />
        )}
      </section>

      {/* Near-breakeven sensitivity strip. When the deal cash-flows right at
          market price, the hero "BE vs Offer" number is tautological — show
          the user what they'd actually take home at various offer discounts
          so they have something actionable to negotiate against. */}
      {breakeven?.nearBreakeven && Array.isArray(breakeven.sensitivity) && (
        <section className="mb-5 rounded-lg border border-border/70 bg-card p-5">
          <div className="mb-2 flex items-center gap-2">
            <Eyebrow>Offer sensitivity</Eyebrow>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Cash flow if you negotiate below ask. At market price the deal is cash-flow neutral
            — these are what moving the price down buys you.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {breakeven.sensitivity.map(
              (s: { offsetPct: number; price: number; monthlyCashFlow: number }) => (
                <div
                  key={s.offsetPct}
                  className="rounded-md border border-border/50 bg-muted/10 px-3 py-2"
                >
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {Math.round(s.offsetPct * 100)}% from ask ({fmt(s.price)})
                  </p>
                  <p
                    className={cn(
                      'mt-1 text-sm font-bold tabular-nums',
                      s.monthlyCashFlow >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-700 dark:text-red-400'
                    )}
                  >
                    {s.monthlyCashFlow >= 0 ? '+' : ''}
                    {fmt(s.monthlyCashFlow)}/mo
                  </p>
                </div>
              )
            )}
          </div>
        </section>
      )}

      {/* Value triangulation — show every independent signal we have for
          the property's value so the buyer can judge confidence themselves.
          Appears right after the hero so it's visible before they scroll. */}
      {valueTriangulation && valueTriangulation.signals?.length > 1 && (
        <section
          className={cn(
            'mb-5 rounded-lg border p-5',
            valueTriangulation.confidence === 'low'
              ? 'border-amber-500/40 bg-amber-500/5'
              : 'border-border/70 bg-card'
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BarChart3Icon className="h-4 w-4 text-primary" />
              <Eyebrow>Value Triangulation</Eyebrow>
            </div>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                valueTriangulation.confidence === 'high' &&
                  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
                valueTriangulation.confidence === 'medium' &&
                  'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                valueTriangulation.confidence === 'low' &&
                  'bg-red-500/15 text-red-700 dark:text-red-400'
              )}
            >
              {valueTriangulation.confidence} confidence · {valueTriangulation.spreadPct}% spread
            </span>
          </div>
          <div className="space-y-2 text-sm">
            {valueTriangulation.signals.map((s: any, i: number) => (
              <div
                key={i}
                className="flex items-start justify-between gap-3 border-b border-border/40 pb-2 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{s.label}</p>
                  <p className="text-[11px] text-muted-foreground">{s.source}</p>
                </div>
                <p className="shrink-0 font-bold tabular-nums text-foreground">
                  {fmt(s.value)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {valueTriangulation.confidence === 'low' &&
              'These estimates diverge by more than 25% — treat the headline number with caution and cross-check with a local agent.'}
            {valueTriangulation.confidence === 'medium' &&
              'Estimates agree within 10-25%. The headline value is reasonable but not precise.'}
            {valueTriangulation.confidence === 'high' &&
              'Multiple independent signals agree within 10% — this value is well-supported.'}
          </p>
        </section>
      )}

      {/* Rent warnings — data-quality flags specific to rent estimates */}
      {rentWarnings && rentWarnings.length > 0 && (
        <section className="mb-5 space-y-2">
          {rentWarnings.map((w: string, i: number) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3"
            >
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs leading-relaxed text-foreground">{w}</p>
            </div>
          ))}
        </section>
      )}

      {/* Report-level warnings — class-of-property & data-gap caveats
          (multi-unit detection, manufactured homes, condo-without-HOA,
          missing-state fallback). Emitted by buildReportWarnings.
          `property-profile-inferred` escalates to a red critical banner
          because every downstream metric is built on inferred data. */}
      {warnings && warnings.length > 0 && (
        <section className="mb-5 space-y-2">
          {warnings.map((w: { code: string; message: string }, i: number) => {
            const critical =
              w.code === 'property-profile-inferred' ||
              w.code === 'condo-misclassified'
            return (
              <div
                key={`${w.code}-${i}`}
                data-warning-code={w.code}
                className={cn(
                  'flex items-start gap-2 rounded-md border px-4 py-3',
                  critical
                    ? 'border-red-500/50 bg-red-500/10'
                    : 'border-amber-500/40 bg-amber-500/5'
                )}
              >
                <AlertTriangleIcon
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    critical
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-600 dark:text-amber-400'
                  )}
                />
                <div className="flex flex-col gap-0.5">
                  {critical && (
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
                      {w.code === 'condo-misclassified'
                        ? 'Likely misclassified — verify property type'
                        : 'Based on inferred property data'}
                    </p>
                  )}
                  <p className="text-xs leading-relaxed text-foreground">{w.message}</p>
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* Recommended Offer Prices — three actionable target prices */}
      {recommendedOffers && (
        <section className="mb-5 rounded-lg border border-border/70 bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <TargetIcon className="h-4 w-4 text-primary" />
            <Eyebrow>Recommended Max Offer</Eyebrow>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <OfferTile
              label="Breakeven (CF ≥ $0)"
              price={recommendedOffers.breakevenPrice}
              description="Deal doesn't lose money monthly"
              tone="neutral"
            />
            <OfferTile
              label={`For ${(recommendedOffers.priceForCashOnCash.target * 100).toFixed(0)}% Cash-on-Cash`}
              price={recommendedOffers.priceForCashOnCash.maxPrice}
              description="Conventional investor target"
              tone="good"
            />
            <OfferTile
              label={`For ${(recommendedOffers.priceForIRR.target * 100).toFixed(0)}% IRR (5yr)`}
              price={recommendedOffers.priceForIRR.maxPrice}
              description="Strong deal threshold"
              tone="great"
            />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Below these prices the deal clears each target. Use the lowest (Breakeven) as
            your walk-away; aim for the tightest (IRR 10%) as your opening offer.
          </p>
        </section>
      )}

      {/* Main (narrative) + Sidebar (reference) grid */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* ───────── MAIN COLUMN ───────── */}
        <div className="space-y-5 lg:col-span-8">
          {/* Deal Doctor AI narrative */}
          {dealDoctor ? (
            <DealDoctorSection dealDoctor={dealDoctor} verdict={ltr.verdict} />
          ) : dealDoctorError ? (
            <AiDiagnosisUnavailableCard uuid={uuid} error={dealDoctorError} />
          ) : null}

          {/* Financing Alternatives — wide table, fits the main column */}
          {financingAlternatives && financingAlternatives.length > 0 && (
            <Card padded={false}>
              <CardHeader label="Financing Alternatives" hint="Same property, three capital structures" />
              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full text-xs tabular-nums sm:text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-muted-foreground">
                      <th className="pb-2 pr-3 text-left font-medium">Loan Type</th>
                      <th className="pb-2 text-right font-medium">Down</th>
                      <th className="pb-2 text-right font-medium">Rate</th>
                      <th className="pb-2 text-right font-medium">P&amp;I</th>
                      <th className="pb-2 text-right font-medium">Cash Flow</th>
                      <th className="pb-2 text-right font-medium">DSCR</th>
                      <th className="pb-2 text-right font-medium">Cash In</th>
                    </tr>
                  </thead>
                  <tbody>
                    {financingAlternatives.map((f: any) => (
                      <tr key={f.id} className="border-b border-border/30 align-top last:border-b-0">
                        <td className="py-2.5 pr-3">
                          <p className="font-medium text-foreground">{f.name}</p>
                          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                            {f.eligibilityNote}
                          </p>
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="font-medium">{pct(f.downPaymentPct, 1)}</div>
                          <div className="text-[10px] text-muted-foreground">{fmt(f.downPayment)}</div>
                        </td>
                        <td className="py-2.5 text-right font-medium">{pct(f.annualRate)}</td>
                        <td className="py-2.5 text-right">{fmt(f.monthlyPayment)}</td>
                        <td
                          className={cn(
                            'py-2.5 text-right font-medium',
                            f.monthlyCashFlow >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-700 dark:text-red-400'
                          )}
                        >
                          {f.monthlyCashFlow >= 0 ? '+' : ''}
                          {fmt(f.monthlyCashFlow)}
                        </td>
                        <td
                          className={cn(
                            'py-2.5 text-right',
                            f.dscr >= 1.25 ? 'text-emerald-700 dark:text-emerald-400 font-medium' : '',
                            f.dscr < 0 ? 'text-red-700 dark:text-red-400 font-medium' : ''
                          )}
                          title={f.dscr < 0 ? 'NOI is negative — operating expenses exceed rent before debt service' : undefined}
                        >
                          {f.dscr < 0 ? 'NOI-neg' : `${f.dscr}x`}
                        </td>
                        <td className="py-2.5 text-right font-bold">{fmt(f.cashToClose)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Sensitivity / What-If Analysis */}
          {sensitivity && sensitivity.length > 0 && (
            <Card padded={false}>
              <CardHeader
                label="Sensitivity &amp; Stress Test"
                hint="How safe is this deal if reality surprises you?"
              />
              <div className="overflow-x-auto px-5 pb-3">
                <table className="w-full text-xs tabular-nums sm:text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-muted-foreground">
                      <th className="pb-2 pr-3 text-left font-medium">Scenario</th>
                      <th className="pb-2 text-right font-medium">Cash Flow</th>
                      <th className="pb-2 text-right font-medium">DSCR</th>
                      <th className="pb-2 text-right font-medium">5yr Wealth</th>
                      <th className="pb-2 text-right font-medium">5yr IRR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sensitivity.map((s: any, i: number) => {
                      const isBase = s.scenario.toLowerCase().includes('base')
                      return (
                        <tr
                          key={i}
                          className={cn(
                            'border-b border-border/30 last:border-b-0',
                            isBase && 'bg-muted/30'
                          )}
                        >
                          <td className="py-2 pr-3">
                            <p className={cn('font-medium text-foreground', isBase && 'font-bold')}>
                              {s.scenario}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{s.description}</p>
                          </td>
                          <td
                            className={cn(
                              'py-2 text-right font-medium',
                              s.monthlyCashFlow >= 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-red-700 dark:text-red-400'
                            )}
                          >
                            {s.monthlyCashFlow >= 0 ? '+' : ''}
                            {fmt(s.monthlyCashFlow)}
                          </td>
                          <td
                            className={cn(
                              'py-2 text-right',
                              s.dscr >= 1.25 ? 'text-emerald-700 dark:text-emerald-400' : '',
                              s.dscr < 0 ? 'text-red-700 dark:text-red-400' : ''
                            )}
                            title={s.dscr < 0 ? 'NOI is negative — operating expenses exceed rent before debt service' : undefined}
                          >
                            {s.dscr < 0 ? 'NOI-neg' : `${s.dscr}x`}
                          </td>
                          <td className="py-2 text-right">{fmt(s.fiveYrWealth)}</td>
                          <td className="py-2 text-right font-medium">
                            {Number.isFinite(s.fiveYrIRR) ? `${(s.fiveYrIRR * 100).toFixed(1)}%` : 'N/A'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border/40 px-5 py-4">
                <Eyebrow>Δ 5-year wealth vs base</Eyebrow>
                <div className="mt-2">
                  <SensitivityTornado rows={sensitivity as any} />
                </div>
              </div>
            </Card>
          )}

          {/* 5-Year Wealth — chart + year-by-year table */}
          {wealthProjection && (
            <Card padded={false}>
              <CardHeader label="5-Year Wealth Build" hint="Cumulative cash flow + equity + tax shield" />
              <div className="px-5 pb-3">
                <WealthAreaChart years={wealthProjection.years} />
              </div>
              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full text-xs tabular-nums sm:text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Year</th>
                      <th className="pb-2 text-right font-medium">Cash Flow</th>
                      <th className="pb-2 text-right font-medium">Tax Shield</th>
                      <th className="pb-2 text-right font-medium">Equity Built</th>
                      <th className="pb-2 text-right font-medium">Loan Bal</th>
                      <th className="pb-2 text-right font-medium">Wealth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wealthProjection.years.map((y: any) => {
                      const equityTotal = y.equityFromPaydown + y.equityFromAppreciation
                      return (
                        <tr key={y.year} className="border-b border-border/30 last:border-b-0">
                          <td className="py-2 font-medium">Y{y.year}</td>
                          <td
                            className={cn(
                              'py-2 text-right',
                              y.cumulativeCashFlow >= 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-red-700 dark:text-red-400'
                            )}
                          >
                            {y.cumulativeCashFlow >= 0 ? '+' : ''}
                            {fmt(y.cumulativeCashFlow)}
                          </td>
                          <td className="py-2 text-right text-emerald-700 dark:text-emerald-400">
                            +{fmt(y.cumulativeTaxShield)}
                          </td>
                          <td
                            className={cn(
                              'py-2 text-right',
                              equityTotal >= 0
                                ? 'text-foreground'
                                : 'text-red-700 dark:text-red-400'
                            )}
                          >
                            {equityTotal >= 0 ? '' : '−'}
                            {fmt(Math.abs(equityTotal))}
                          </td>
                          <td className="py-2 text-right">{fmt(y.loanBalance)}</td>
                          <td className="py-2 text-right font-bold text-primary">
                            {fmt(y.totalWealthBuilt)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Wealth = Cash Flow + Tax Shield + Equity Built (cumulative through end of year).
                </p>
                <p className="mt-3 text-[10px] text-muted-foreground">
                  {pct(wealthProjection.assumptions.rentGrowthRate, 1)} rent growth
                  {wealthProjection.assumptions.rentGrowthSource === 'zip-12mo' && (
                    <span className="ml-1 rounded bg-emerald-500/10 px-1 text-[8px] font-semibold text-emerald-700 dark:text-emerald-400">
                      zip
                    </span>
                  )}
                  ,{' '}{pct(wealthProjection.assumptions.appreciationRate, 1)} appreciation
                  {wealthProjection.assumptions.appreciationSource === 'zip-12mo' && (
                    <span className="ml-1 rounded bg-emerald-500/10 px-1 text-[8px] font-semibold text-emerald-700 dark:text-emerald-400">
                      zip
                    </span>
                  )}
                  ,{' '}{pct(wealthProjection.assumptions.expenseGrowthRate, 1)} expense growth
                  {wealthProjection.assumptions.stateTaxGrowth != null &&
                    wealthProjection.assumptions.stateTaxGrowth !== 0.03 && (
                      <span className="ml-1 rounded bg-emerald-500/10 px-1 text-[8px] font-semibold text-emerald-700 dark:text-emerald-400">
                        {property.state} tax modeled
                      </span>
                    )}
                  ,{' '}{pct(wealthProjection.assumptions.effectiveTaxRate, 0)} effective tax rate.
                </p>
              </div>
            </Card>
          )}

          {/* Short-Term Rental (STR) Projection */}
          {!hideInLenderView('str') && strProjection && (
            <Card>
              <CardHeader
                label="Short-Term Rental Comparison"
                hint={`If you pivot to Airbnb/VRBO — assumes ${(strProjection.estimatedOccupancy * 100).toFixed(0)}% occupancy`}
              />
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* LTR column */}
                <div className="rounded-md border border-border/60 bg-background/40 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Long-Term Rental (base)
                  </p>
                  <p className="mt-1 text-sm text-foreground tabular-nums">
                    Rent:{' '}
                    <span className="font-semibold">
                      {fmt(data.inputs?.monthlyRent ?? ltr.noiAnnual / 12 + expenses.monthlyTotal)}/mo
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                    Net CF:{' '}
                    <span
                      className={cn(
                        'font-semibold',
                        ltr.monthlyNetCashFlow >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      )}
                    >
                      {ltr.monthlyNetCashFlow >= 0 ? '+' : ''}
                      {fmt(ltr.monthlyNetCashFlow)}/mo
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                    DSCR: <span className="font-semibold text-foreground">{ltr.dscr < 0 ? 'NOI-neg' : `${ltr.dscr}x`}</span>
                    {ltr.dscr < 0 && (
                      <span className="ml-2 text-[11px] text-red-700 dark:text-red-400">(operating expenses exceed rent)</span>
                    )}
                  </p>
                </div>

                {/* STR column */}
                <div
                  className={cn(
                    'rounded-md border p-3',
                    strProjection.vsLTRMonthlyDelta > 0
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-amber-500/40 bg-amber-500/5'
                  )}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Short-Term Rental
                  </p>
                  <p className="mt-1 text-sm text-foreground tabular-nums">
                    Gross: <span className="font-semibold">{fmt(strProjection.monthlyGrossRevenue)}/mo</span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                    Net CF:{' '}
                    <span
                      className={cn(
                        'font-semibold',
                        strProjection.monthlyNetCashFlow >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      )}
                    >
                      {strProjection.monthlyNetCashFlow >= 0 ? '+' : ''}
                      {fmt(strProjection.monthlyNetCashFlow)}/mo
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                    DSCR: <span className="font-semibold text-foreground">{strProjection.annualDSCR < 0 ? 'NOI-neg' : `${strProjection.annualDSCR}x`}</span>
                  </p>
                  <p className="mt-2 text-[11px] font-semibold text-foreground">
                    {strProjection.vsLTRMonthlyDelta > 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        STR wins by {fmt(strProjection.vsLTRMonthlyDelta)}/mo
                      </span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">
                        LTR wins by {fmt(-strProjection.vsLTRMonthlyDelta)}/mo
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  STR monthly opex breakdown
                </p>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums sm:grid-cols-3">
                  <Line label="Management (20%)" value={fmt(strProjection.breakdown.management)} />
                  <Line label="Cleaning (10%)" value={fmt(strProjection.breakdown.cleaning)} />
                  <Line label="Platform + supplies" value={fmt(strProjection.breakdown.suppliesAndPlatformFees)} />
                  <Line label="Utilities (owner)" value={fmt(strProjection.breakdown.utilities)} />
                  <Line label="Insurance (+50%)" value={fmt(strProjection.breakdown.insurance)} />
                  <Line label="Property tax" value={fmt(strProjection.breakdown.propertyTax)} />
                </div>
              </div>

              <p className="mt-3 text-[10px] text-muted-foreground">
                STR revenue estimate uses bedroom-scaled city baseline; verify against AirDNA or
                comparable listings before committing to this strategy.
              </p>
            </Card>
          )}

          {/* Interactive rehab estimator (no-print, hidden in lender view) */}
          {!hideInLenderView('rehab') && data.inputs && (
            <RehabEstimator
              offerPrice={property.offerPrice ?? property.askPrice}
              downPaymentPct={property.downPaymentPct ?? 0.20}
              annualRate={data.inputs.annualRate}
              loanAmount={ltr.loanAmount}
              monthlyRent={data.inputs.monthlyRent}
              vacancyRate={data.inputs.vacancyRate}
              monthlyExpenses={data.inputs.monthlyExpenses}
              monthlyMortgagePayment={ltr.monthlyMortgagePayment}
              annualDepreciation={ltr.annualDepreciation}
              baselineMonthlyCashFlow={ltr.monthlyNetCashFlow}
              baselineCashToClose={cashToClose?.totalCashToClose ?? 0}
              baseline5yrWealth={wealthProjection?.hero?.totalWealthBuilt5yr ?? 0}
              baseline5yrIRR={wealthProjection?.hero?.irr5yr ?? 0}
              baselineDSCR={ltr.dscr}
            />
          )}

          {/* Rent Comparables */}
          {rentComps && rentComps.length > 0 && (
            <Card>
              <CardHeader label="Rent Comparables" hint="Nearby rentals that priced the rent estimate" />
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {rentComps.map((c: any, i: number) => (
                  <div
                    key={i}
                    className="rounded-md border border-border/60 bg-background/50 p-3"
                  >
                    <p className="truncate text-sm font-medium text-foreground">{c.address}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                      <span className="text-sm font-bold text-foreground">{fmt(c.rent)}/mo</span>
                      {c.bedrooms != null && (
                        <span>
                          {c.bedrooms}bd{c.bathrooms != null ? `/${c.bathrooms}ba` : ''}
                        </span>
                      )}
                      {c.square_feet > 0 ? (
                        <span>{c.square_feet.toLocaleString()} sqft</span>
                      ) : null}
                      {typeof c.distance_miles === 'number' && <span>· {c.distance_miles.toFixed(1)}mi</span>}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                If these don&apos;t look comparable, verify the rent estimate with a local property manager.
              </p>
            </Card>
          )}

          {/* Sale Comparables */}
          {comparableSales && comparableSales.length > 0 && (
            <Card>
              <CardHeader label="Sale Comparables" hint="Used to derive ARV for the 70%-rule flip offer" />
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {comparableSales.map((comp: any, i: number) => (
                  <div
                    key={i}
                    className="rounded-md border border-border/60 bg-background/50 p-3"
                  >
                    <p className="truncate text-sm font-medium text-foreground">{comp.address}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                      <span className="text-sm font-bold text-foreground">
                        {fmt(comp.estimated_value)}
                      </span>
                      {comp.price_per_sqft != null && (
                        <span className="rounded bg-muted/60 px-1 font-semibold text-foreground">
                          ${comp.price_per_sqft}/sqft
                        </span>
                      )}
                      <span>
                        {comp.bedrooms}bd/{comp.bathrooms}ba
                      </span>
                      {comp.square_feet > 0 ? (
                        <span>{comp.square_feet.toLocaleString()} sqft</span>
                      ) : null}
                      {typeof comp.days_on_market === 'number' && comp.days_on_market > 0 ? (
                        <span>{comp.days_on_market} DOM</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ───────── SIDEBAR (reference data) ───────── */}
        <aside className="space-y-5 lg:col-span-4">
          {/* Quick metrics 2×2 */}
          <Card>
            <CardHeader label="Year-1 Metrics" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniStat
                label="Cash Flow"
                value={`${ltr.monthlyNetCashFlow >= 0 ? '+' : ''}${fmt(ltr.monthlyNetCashFlow)}/mo`}
                tone={ltr.monthlyNetCashFlow >= 0 ? 'pos' : 'neg'}
              />
              <MiniStat
                label="DSCR"
                value={ltr.dscr < 0 ? 'NOI-neg' : `${ltr.dscr}x`}
                tone={ltr.dscr >= 1.25 ? 'pos' : 'neg'}
              />
              <MiniStat label="Cap Rate" value={`${ltr.capRate}%`} />
              <MiniStat label="Cash-on-Cash" value={`${ltr.cashOnCashReturn}%`} />
            </div>
          </Card>

          {/* Location Quality — walkability + key amenities nearby */}
          {locationSignals && (
            <Card>
              <CardHeader label="Location Quality" />
              <div className="mt-2 flex items-baseline justify-between">
                <div>
                  {locationSignals.dataConfidence === 'high' ? (
                    <p className="font-[family-name:var(--font-playfair)] text-3xl font-bold tabular-nums text-foreground">
                      {locationSignals.walkabilityScore}
                    </p>
                  ) : (
                    <p className="font-[family-name:var(--font-playfair)] text-xl font-bold text-muted-foreground">
                      —
                    </p>
                  )}
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {locationSignals.dataConfidence === 'high'
                      ? locationSignals.walkabilityLabel
                      : 'Walkability data unavailable'}
                  </p>
                  {locationSignals.dataConfidence !== 'high' && (
                    <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                      Our amenity map has gaps in this area — verify on{' '}
                      <a
                        href="https://www.walkscore.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-amber-700 dark:hover:text-amber-300"
                      >
                        walkscore.com
                      </a>{' '}
                      directly.
                    </p>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  ~½ mile radius
                </p>
              </div>

              <div className="mt-3 space-y-1.5 text-sm">
                {(
                  [
                    ['groceries', 'Grocery'],
                    ['restaurants', 'Food'],
                    ['transit', 'Transit stops'],
                    ['schools', 'Schools'],
                    ['parks', 'Parks'],
                  ] as const
                ).map(([key, label]) => {
                  const a = locationSignals.amenities[key]
                  if (a.count === 0) return null
                  return (
                    <div key={key} className="flex items-center justify-between text-[12px]">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="tabular-nums text-foreground">
                        <span className="font-semibold">{a.count}</span>
                        {a.nearestMeters != null && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            nearest {a.nearestMeters < 160
                              ? `${a.nearestMeters}m`
                              : `${(a.nearestMeters / 1609.344).toFixed(1)}mi`}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Wealth composition pie — where the 5yr wealth actually comes from */}
          {!hideInLenderView('composition') && wealthProjection && (
            <Card>
              <CardHeader label="Where Wealth Comes From" />
              <div className="mt-2">
                <WealthCompositionPie hero={wealthProjection.hero} />
              </div>
            </Card>
          )}

          {/* Local Market Snapshot — zip-level context */}
          {marketSnapshot && (marketSnapshot.salePriceMedian || marketSnapshot.rentMedian) && (
            <Card>
              <CardHeader label={`Zip ${marketSnapshot.zipCode} Market`} />
              <div className="mt-2 space-y-1.5 text-sm">
                {marketSnapshot.salePriceMedian != null && (
                  <Line
                    label="Median sale"
                    value={fmt(marketSnapshot.salePriceMedian)}
                    strong
                  />
                )}
                {marketSnapshot.rentMedian != null && (
                  <Line label="Median rent" value={`${fmt(marketSnapshot.rentMedian)}/mo`} />
                )}
                {marketSnapshot.pricePerSqft != null && (
                  <Line label="$ / sqft" value={`$${marketSnapshot.pricePerSqft}`} />
                )}
                {marketSnapshot.avgDaysOnMarket != null && (
                  <Line
                    label="Avg days on market"
                    value={`${Math.round(marketSnapshot.avgDaysOnMarket)}d`}
                  />
                )}
              </div>
              {(marketSnapshot.salePriceGrowth12mo != null ||
                marketSnapshot.rentGrowth12mo != null) && (
                <div className="mt-3 border-t border-border/40 pt-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    12-month change
                  </p>
                  <div className="space-y-1 text-sm">
                    {marketSnapshot.salePriceGrowth12mo != null && (
                      <Line
                        label="Sale price"
                        value={`${marketSnapshot.salePriceGrowth12mo >= 0 ? '+' : ''}${(marketSnapshot.salePriceGrowth12mo * 100).toFixed(1)}%`}
                        tone={marketSnapshot.salePriceGrowth12mo >= 0 ? 'pos' : 'neg'}
                      />
                    )}
                    {marketSnapshot.rentGrowth12mo != null && (
                      <Line
                        label="Rent"
                        value={`${marketSnapshot.rentGrowth12mo >= 0 ? '+' : ''}${(marketSnapshot.rentGrowth12mo * 100).toFixed(1)}%`}
                        tone={marketSnapshot.rentGrowth12mo >= 0 ? 'pos' : 'neg'}
                      />
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Cash to Close */}
          {cashToClose && (
            <Card>
              <CardHeader label="Total Cash to Close" />
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {fmt(cashToClose.totalCashToClose)}
              </p>
              <p className="text-[10px] text-muted-foreground">What you need liquid at closing</p>
              <div className="mt-3 space-y-1.5 text-sm">
                <Line label="Down payment" value={fmt(cashToClose.downPayment)} />
                <Line label="Closing (~2.5%)" value={fmt(cashToClose.closingCosts)} />
                <Line label="Inspect + appraise" value={fmt(cashToClose.inspectionAndAppraisal)} />
                <Line label="6mo PITI reserves" value={fmt(cashToClose.reserves)} />
                {cashToClose.rehabBudget > 0 && (
                  <Line label="Rehab budget" value={fmt(cashToClose.rehabBudget)} />
                )}
              </div>
            </Card>
          )}

          {/* Rates + DSCR combined */}
          <Card>
            <CardHeader label="Financing" />
            <div className="mt-2 space-y-1 text-sm">
              <Line
                label="PMMS 30yr (owner-occ)"
                value={`${(rates.mortgage30yr * 100).toFixed(2)}%`}
                muted
              />
              <Line
                label="Investor rate applied"
                value={`${(((rates.mortgage30yrInvestor ?? rates.mortgage30yr) * 100)).toFixed(2)}%`}
                strong
              />
              <div className="my-2 border-t border-border/40" />
              <Line label="Loan amount" value={fmt(ltr.loanAmount)} />
              <Line label="LTV" value={`${(ltr.ltv * 100).toFixed(0)}%`} />
              <Line label="Annual NOI" value={fmt(ltr.noiAnnual)} />
              <Line label="Monthly P&I" value={fmt(ltr.monthlyMortgagePayment)} />
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              PMMS is owner-occupied; investor rate applied to all math below.
            </p>
          </Card>

          {/* Expenses */}
          {expenses && (
            <Card>
              <CardHeader label="Monthly Carrying Costs" />
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {fmt(expenses.monthlyTotal)}
              </p>
              <div className="mt-3 space-y-1.5 text-sm">
                <Line
                  label={
                    <span className="flex items-center gap-1.5">
                      Property tax
                      {expenses.propertyTaxSource === 'county-record' && (
                        <span className="rounded bg-emerald-500/10 px-1 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400">
                          county
                        </span>
                      )}
                      {expenses.propertyTaxSource === 'city-override' && (
                        <span
                          title="Jurisdictional effective rate applied — we have a city/county-specific rate for this market but no parcel-level tax record. Verify against the actual tax bill before relying on the carrying cost."
                          className="rounded bg-amber-500/10 px-1 text-[9px] font-semibold text-amber-700 dark:text-amber-400"
                        >
                          county est
                        </span>
                      )}
                      {expenses.propertyTaxSource === 'state-average' && (
                        <span
                          title="State average applied — no county record for this parcel. Pull the actual tax bill before making an offer."
                          className="rounded bg-amber-500/10 px-1 text-[9px] font-semibold text-amber-700 dark:text-amber-400"
                        >
                          state avg
                        </span>
                      )}
                    </span>
                  }
                  value={fmt(expenses.monthlyPropertyTax)}
                />
                <Line label="Insurance" value={fmt(expenses.monthlyInsurance)} />
                <Line label="Maintenance" value={fmt(expenses.monthlyMaintenance)} />
                {expenses.monthlyHOA > 0 && (
                  <Line
                    label={
                      <span className="flex items-center gap-1.5">
                        HOA
                        {(expenses as { hoaSource?: string }).hoaSource === 'inferred-condo-default' && (
                          <span
                            title="HOA is a market default for a condo/apartment of this size, not a captured disclosure. The real number could be lower (older walk-up without elevator) or materially higher (building with a reserve-funded special assessment). Pull the listing's monthly dues before trusting the cash-flow number."
                            className="rounded bg-amber-500/10 px-1 text-[9px] font-semibold text-amber-700 dark:text-amber-400"
                          >
                            assumed
                          </span>
                        )}
                      </span>
                    }
                    value={fmt(expenses.monthlyHOA)}
                  />
                )}
              </div>
              {(expenses as { hoaSource?: string }).hoaSource === 'inferred-condo-default' && (
                <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">
                  HOA above is an estimated market default, not a captured disclosure. Confirm the listing&apos;s actual monthly dues — it&apos;s the single biggest driver of the cash-flow number.
                </p>
              )}
              {expenses.propertyTaxSource === 'state-average' &&
                property.state === 'NY' &&
                /new york|brooklyn|queens|bronx|staten/i.test(property.city || '') && (
                  <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">
                    NYC assesses condos well below market value under the 421-a / assessment-cap system. Actual taxes are typically lower than this state-average projection — verify on the ACRIS record or the listing&apos;s tax history before relying on cash-flow math.
                  </p>
                )}
              {expenses.monthlyHOA === 0 &&
                (property.propertyType || '').toLowerCase().includes('condo') && (
                  <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">
                    HOA not captured — condos often have $150–$500/mo dues. Verify.
                  </p>
                )}
            </Card>
          )}

          {/* Depreciation */}
          {!hideInLenderView('tax') && (
          <Card>
            <CardHeader label="Year-1 Tax Benefits" />
            <div className="mt-2 space-y-1.5 text-sm">
              <Line label="Annual depreciation" value={fmt(ltr.annualDepreciation)} />
              <Line
                label="Est. tax saving"
                value={fmt(ltr.estimatedTaxSaving)}
                tone="pos"
              />
              <Line label="After-tax cash flow" value={`${fmt(ltr.afterTaxCashFlow)}/yr`} />
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              27.5yr straight-line on ~80% building basis; 28% effective rate.
            </p>
          </Card>
          )}

          {/* Climate & Insurance — condensed */}
          {climate && (
            <Card>
              <CardHeader label="Climate &amp; Insurance" />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Annual ins.
                  </p>
                  <p className="text-base font-bold tabular-nums">
                    {fmt(climate.estimatedAnnualInsurance)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Flood zone
                  </p>
                  <p
                    className={cn(
                      'text-base font-bold',
                      climate.floodInsuranceRequired && 'text-red-700 dark:text-red-400'
                    )}
                  >
                    {climate.floodZone || '—'}
                  </p>
                </div>
              </div>
              {climate.topConcerns?.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Top risks
                  </p>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-foreground">
                    {climate.topConcerns.slice(0, 3).map((c: string) => (
                      <li key={c}>• {c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {climate.climateScores && (
                <div className="mt-3 space-y-1">
                  <ScoreRow label="Hurricane" score={climate.climateScores.hurricane} />
                  <ScoreRow label="Wildfire" score={climate.climateScores.wildfire} />
                  <ScoreRow label="Heat" score={climate.climateScores.heat} />
                  <ScoreRow label="Drought" score={climate.climateScores.drought} />
                  <ScoreRow label="Tornado" score={climate.climateScores.tornado} />
                </div>
              )}
            </Card>
          )}

          {/* Refi scenarios — 3 key rates only */}
          {ltr.renewalScenarios && ltr.renewalScenarios.length > 0 && (
            <Card>
              <CardHeader label="5yr Refi Stress Test" />
              <table className="mt-2 w-full text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-border/40 text-muted-foreground">
                    <th className="pb-1.5 text-left font-medium">Rate</th>
                    <th className="pb-1.5 text-right font-medium">Payment</th>
                    <th className="pb-1.5 text-right font-medium">Cash Flow</th>
                  </tr>
                </thead>
                <tbody>
                  {ltr.renewalScenarios
                    .filter((_: any, i: number) => [0, 2, 4, 6].includes(i)) // 5, 6, 7, 8%
                    .map((s: any) => (
                      <tr key={s.rate} className="border-b border-border/20 last:border-b-0">
                        <td className="py-1.5 font-medium">{pct(s.rate, 1)}</td>
                        <td className="py-1.5 text-right">{fmt(s.monthlyPayment)}</td>
                        <td
                          className={cn(
                            'py-1.5 text-right font-medium',
                            s.monthlyCashFlow >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-700 dark:text-red-400'
                          )}
                        >
                          {s.monthlyCashFlow >= 0 ? '+' : ''}
                          {fmt(s.monthlyCashFlow)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* State rules */}
          {stateRules && (
            <Card>
              <CardHeader label={`${stateRules.state} Regulations`} />
              <div className="mt-2 space-y-1 text-[11px] text-foreground">
                <RegLine
                  positive={!stateRules.rentControl}
                  label={stateRules.rentControl ? 'Rent control' : 'No rent control'}
                />
                <RegLine
                  positive={stateRules.landlordFriendly}
                  label={stateRules.landlordFriendly ? 'Landlord-friendly' : 'Tenant-friendly'}
                />
                <RegLine
                  neutral
                  label={`Property tax ~${(stateRules.propertyTaxRate * 100).toFixed(1)}%`}
                />
              </div>
              {stateRules.strNotes && (
                <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                  <span className="font-medium text-foreground">STR:</span> {stateRules.strNotes}
                </p>
              )}
            </Card>
          )}
        </aside>
      </div>

      {/* Cross-check links — signals confidence (we're not afraid to link
          competitors) and gives buyers a one-click path to verify our numbers
          against Zillow / Redfin / Realtor. Via Google search-redirect because
          Zillow doesn't expose direct address URLs programmatically. */}
      {crossCheckLinks && (
        <div className="rounded-lg border border-dashed border-border/60 bg-background/40 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground">
            Cross-check this property
          </p>
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            Every AVM has error bars. Click through to verify our numbers against the majors —
            we&apos;d rather you trust our math because you checked, than because we said so.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { href: crossCheckLinks.zillow, label: 'Zillow' },
              { href: crossCheckLinks.redfin, label: 'Redfin' },
              { href: crossCheckLinks.realtor, label: 'Realtor.com' },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                {link.label}
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Data Sources footer */}
      <footer className="mt-8 rounded-lg border border-dashed border-border/60 bg-background/40 p-4 text-[11px] leading-relaxed text-muted-foreground">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground">
          Data Sources
        </p>
        <p>
          Property / rent / value — Rentcast AVM. Sale comps — Rentcast sold records within ~1 mile
          of subject property. Zip-level market trends — Rentcast /markets. Flood zone — FEMA NFHL.
          Location signals (walkability, amenities) — Mapbox Tilequery on Streets v8. Rates — Freddie
          Mac PMMS + strategy-adjusted investor premium. Insurance baseline — NAIC state averages.
          State property-tax growth modeled per jurisdiction (Prop 13, Save-Our-Homes, TX uncapped).
          Climate scores, STR estimates, breakeven — DealDoctor models. Narrative + photo review —
          Anthropic. Full methodology at{' '}
          <a href="/methodology" className="underline hover:text-foreground">
            /methodology
          </a>
          . Not an appraisal or inspection.
        </p>
      </footer>
    </div>
  )
}

/* ───── Compositional helpers ───── */

function AiDiagnosisUnavailableCard({ uuid, error }: { uuid?: string; error: string }) {
  const [state, setState] = useState<'idle' | 'retrying' | 'failed'>('idle')

  const retry = async () => {
    if (!uuid || state === 'retrying') return
    setState('retrying')
    try {
      const res = await fetch(`/api/report/${uuid}/retry-ai`, { method: 'POST' })
      if (res.ok) {
        // Successful retry wrote new dealDoctor into fullReportData; reload to
        // pick up the fresh payload. Simpler than threading mutated state back
        // through the report page's polling loop.
        window.location.reload()
        return
      }
      setState('failed')
    } catch {
      setState('failed')
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">AI diagnosis unavailable</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
          {uuid && (
            <button
              onClick={retry}
              disabled={state === 'retrying'}
              className={cn(
                'mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium transition-colors',
                state === 'retrying'
                  ? 'cursor-not-allowed text-muted-foreground'
                  : 'hover:bg-muted hover:text-foreground'
              )}
            >
              <RefreshCwIcon
                className={cn('h-3 w-3', state === 'retrying' && 'animate-spin')}
              />
              {state === 'retrying'
                ? 'Retrying…'
                : state === 'failed'
                ? 'Retry failed — try again'
                : 'Retry AI analysis'}
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
      {children}
    </p>
  )
}

function Dot() {
  return <span className="mx-1.5 text-muted-foreground/40">·</span>
}

function Card({
  children,
  padded = true,
}: {
  children: React.ReactNode
  padded?: boolean
}) {
  return (
    <section
      className={cn(
        'rounded-lg border border-border/70 bg-card',
        padded && 'p-5'
      )}
    >
      {children}
    </section>
  )
}

function CardHeader({ label, hint }: { label: React.ReactNode; hint?: string }) {
  return (
    <div className={cn(hint ? 'px-5 pt-5' : '')}>
      <Eyebrow>{label}</Eyebrow>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function HeroCell({
  label,
  value,
  sub,
}: {
  label: string
  value: React.ReactNode
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card px-4 py-3">
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-1 font-[family-name:var(--font-playfair)] text-2xl font-bold leading-tight tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-1 text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'pos' | 'neg'
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 text-base font-bold tabular-nums',
          tone === 'pos' && 'text-emerald-700 dark:text-emerald-400',
          tone === 'neg' && 'text-red-700 dark:text-red-400'
        )}
      >
        {value}
      </p>
    </div>
  )
}

function Line({
  label,
  value,
  strong,
  muted,
  tone,
}: {
  label: React.ReactNode
  value: string
  strong?: boolean
  muted?: boolean
  tone?: 'pos' | 'neg'
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={cn(
          'text-muted-foreground',
          strong && 'font-medium text-foreground',
          muted && 'opacity-70'
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'tabular-nums font-medium text-foreground',
          strong && 'font-bold',
          muted && 'line-through opacity-60',
          tone === 'pos' && 'text-emerald-700 dark:text-emerald-400',
          tone === 'neg' && 'text-red-700 dark:text-red-400'
        )}
      >
        {value}
      </span>
    </div>
  )
}

function ScoreRow({ label, score }: { label: string; score: number }) {
  const pct = Math.min(100, Math.max(0, (score / 5) * 100))
  const color =
    score >= 4 ? 'bg-red-500' :
    score >= 3 ? 'bg-amber-500' :
    score >= 1 ? 'bg-emerald-500' :
    'bg-muted-foreground/20'
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-[10px] text-muted-foreground">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function OfferTile({
  label,
  price,
  description,
  tone,
}: {
  label: string
  price: number
  description: string
  tone: 'neutral' | 'good' | 'great'
}) {
  const borderTone =
    tone === 'great' ? 'border-primary/50 bg-primary/5'
    : tone === 'good' ? 'border-emerald-500/40 bg-emerald-500/5'
    : 'border-border/70 bg-background/40'
  const priceTone =
    tone === 'great' ? 'text-primary'
    : tone === 'good' ? 'text-emerald-700 dark:text-emerald-400'
    : 'text-foreground'
  return (
    <div className={cn('rounded-lg border px-4 py-3', borderTone)}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-1 font-[family-name:var(--font-playfair)] text-2xl font-bold tabular-nums', priceTone)}>
        {price > 0 ? fmt(price) : '—'}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
    </div>
  )
}

function RegLine({
  positive,
  neutral,
  label,
}: {
  positive?: boolean
  neutral?: boolean
  label: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          'h-1 w-1 shrink-0 rounded-full',
          neutral
            ? 'bg-muted-foreground/40'
            : positive
              ? 'bg-emerald-500'
              : 'bg-amber-500'
        )}
      />
      <span>{label}</span>
    </div>
  )
}
