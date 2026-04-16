'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { AddressInput } from '@/components/AddressInput'
import { TeaserMetrics } from '@/components/TeaserMetrics'
import { BlurredReport } from '@/components/BlurredReport'
import { LiveCounter } from '@/components/LiveCounter'
import { Logo } from '@/components/Logo'
import {
  ShieldCheckIcon,
  ZapIcon,
  BarChart3Icon,
  BanknoteIcon,
  LineChartIcon,
  LandmarkIcon,
  ActivityIcon,
  UsersIcon,
  UmbrellaIcon,
  CameraIcon,
  WrenchIcon,
  HomeIcon,
  SparklesIcon,
  TargetIcon,
  CheckCircle2Icon,
  MapPinIcon,
  PercentIcon,
  ChevronDownIcon,
} from 'lucide-react'
import { FAQ } from '@/lib/faq'

// ─── Editorial sections — organized as columns of an investment circular ──

const SECTIONS = [
  {
    roman: 'I.',
    label: 'Underwriting math',
    lede: 'Every figure is deterministic given its inputs. No magic; each line of the math is documented in the methodology.',
    items: [
      {
        icon: TargetIcon,
        title: 'Exact Breakeven Offer Price',
        desc: 'Binary-searches the purchase price at which Year-1 cash flow crosses zero given today\'s rent estimate and the investor-adjusted mortgage rate. Your literal walk-away number.',
      },
      {
        icon: BanknoteIcon,
        title: 'Total Cash to Close',
        desc: 'Down payment, ~2.5% closing, inspection, appraisal, 6-month PITI reserves, rehab. The real "how much do I need?" figure.',
      },
      {
        icon: LineChartIcon,
        title: '5-Year Wealth Projection with IRR',
        desc: 'Cumulative cash flow plus principal paydown, appreciation, and depreciation tax shield. Year-5 sale assumes 6% selling costs.',
      },
      {
        icon: LandmarkIcon,
        title: 'Financing Alternatives',
        desc: 'FHA · Conventional Investor · DSCR. Side-by-side: down, rate, DSCR, cash-to-close. The adjustment other tools silently skip.',
      },
      {
        icon: ActivityIcon,
        title: 'Sensitivity Stress Test',
        desc: 'Rent ±10%, rate +100 bps, expenses +20%, appreciation 0–5%. A tornado chart ranks which risk carries the most downside.',
      },
    ],
  },
  {
    roman: 'II.',
    label: 'Data anchors',
    lede: 'Real market signal behind every computation — so you can verify, not just trust.',
    items: [
      {
        icon: HomeIcon,
        title: 'Address-Adjacent Sale Comps',
        desc: 'Rentcast sold records within a 1-mile radius, with $/sqft and days-on-market.',
      },
      {
        icon: UsersIcon,
        title: 'Rent Comparables',
        desc: 'Nearby rentals the rent estimate was priced against — the number that drives everything else.',
      },
      {
        icon: BarChart3Icon,
        title: 'Zip-Level Market Growth',
        desc: '12-month price and rent trends piped into the 5-year projection. No flat 3% guess.',
      },
      {
        icon: UmbrellaIcon,
        title: 'Climate & Insurance',
        desc: 'FEMA flood zone + NAIC state baseline + hazard scores flow into the monthly expense stack.',
      },
      {
        icon: MapPinIcon,
        title: 'Location Quality',
        desc: 'Walkability, amenity counts (groceries, transit, schools, parks) within ~½ mile via Mapbox Tilequery.',
      },
    ],
  },
  {
    roman: 'III.',
    label: 'AI diagnosis',
    lede: 'A property-specific read from a reasoning model — not a template.',
    items: [
      {
        icon: SparklesIcon,
        title: 'Deal Doctor Diagnosis',
        desc: 'Pros, cons, three negotiation scripts with specific dollar amounts, and two property-specific inspection red flags tied to year built and climate. Powered by Anthropic.',
      },
      {
        icon: CameraIcon,
        title: 'Photo Red-Flag Review',
        desc: 'Drop listing photos; the vision model flags observable condition concerns — roof, water damage, visible structural — with severity.',
      },
    ],
  },
  {
    roman: 'IV.',
    label: 'Professional polish',
    lede: 'The details a lender or partner will look for.',
    items: [
      {
        icon: WrenchIcon,
        title: 'Interactive Rehab Estimator',
        desc: 'Enter rehab cost + expected rent bump; every metric (cash flow, DSCR, wealth, IRR) recomputes live.',
      },
      {
        icon: ZapIcon,
        title: 'STR vs LTR Comparison',
        desc: 'Full Airbnb/VRBO P&L with 43% variable opex + STR-specific insurance. A verdict chip calls the winner by $/mo.',
      },
      {
        icon: PercentIcon,
        title: 'State Property-Tax Modeling',
        desc: 'CA Prop 13 2%/yr cap, FL Save-Our-Homes 3%, TX uncapped. Per-state reality instead of a flat growth rate.',
      },
      {
        icon: ShieldCheckIcon,
        title: 'Investor-Rate Premium Applied',
        desc: '+75 bps over Freddie Mac PMMS for DSCR and non-owner-occupied loans. Flips DEAL vs PASS on marginal deals.',
      },
    ],
  },
] as const


const INCLUDED_IN_EVERY_REPORT = [
  'Exact breakeven offer price + three recommended offer tiers',
  'Year-1 metrics: cash flow, DSCR, cap rate, cash-on-cash',
  'Total cash to close (down + closing + reserves + rehab)',
  '5-year wealth projection with IRR and year-by-year table',
  'Financing alternatives (FHA · Conventional · DSCR)',
  'Sensitivity stress test + tornado chart',
  'Rent comparables + address-adjacent sale comparables',
  'Zip-level 12-month price and rent growth',
  'Climate risk (FEMA flood zone) + estimated annual insurance',
  'Location quality (walkability + nearby amenities)',
  'AI Deal Doctor: pros/cons, 3 negotiation scripts, 2 inspection red flags',
  'STR vs LTR P&L comparison',
  'Interactive rehab estimator with live recompute',
  'Refi stress test (5-year hold, rates 5%–8%)',
  'State-specific property-tax growth modeling',
  'Photo red-flag AI review',
  'Multi-sheet Excel export + print-to-PDF',
  'Lender-ready view toggle',
  'Save to portfolio in this browser for side-by-side comparison',
  'Secure share link + email recovery for your own purchases',
]

const VOLUME_STAMP = (() => {
  const d = new Date()
  const month = d.toLocaleString('en-US', { month: 'long' }).toUpperCase()
  return `VOL. I · ${month} ${d.getFullYear()}`
})()

export default function LandingContent() {
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const biggerPocketsFaqIndex = FAQ.findIndex((item) =>
    item.q.includes('BiggerPockets') || item.q.includes('DealCheck')
  )
  const [expandedFaq, setExpandedFaq] = useState<number | null>(
    biggerPocketsFaqIndex >= 0 ? biggerPocketsFaqIndex : 0
  )

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[hsl(var(--background))] text-foreground">
      {/* Paper-grain atmosphere (very subtle) */}
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.35]" aria-hidden="true">
        <svg width="100%" height="100%">
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" />
            <feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0 0.15  0 0 0 0.06 0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain)" />
        </svg>
      </div>

      {/* ─── Masthead ───────────────────────────────────────────────── */}
      <header className="no-print border-b border-[hsl(var(--foreground))]/20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.22em] text-foreground/70">
          <span className="font-mono tabular-nums">{VOLUME_STAMP}</span>
          <span className="hidden items-center gap-2 md:flex">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-700 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-700" />
            </span>
            <span>US Mortgage Rates · Live</span>
          </span>
        </div>
        <div className="border-y border-[hsl(var(--foreground))]/80">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
            <Logo variant="wordmark" size="md" />
            <div className="flex items-center gap-7 text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/80">
              <a href="#report" className="hover:text-foreground transition-colors">The Report</a>
              <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
              <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
              <span className="h-4 w-px bg-foreground/20" />
              <a href="/retrieve" className="hover:text-foreground transition-colors">Retrieve</a>
              <a href="/portfolio" className="hover:text-foreground transition-colors">Portfolio</a>
              {process.env.NODE_ENV === 'development' && (
                <a
                  href="/api/auth/reset"
                  className="inline-flex items-center gap-1 border border-dashed border-amber-700/60 bg-amber-500/10 px-2 py-1 font-mono text-[10px] normal-case tracking-normal text-amber-800 hover:bg-amber-500/20"
                  title="Dev: clear entitlement cookie so the paywall + debug link reappear after a test purchase"
                >
                  🔧 Reset entitlement
                </a>
              )}
            </div>
          </nav>
        </div>
      </header>

      {/* ─── Hero / Front page ─────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-5 pt-12 pb-8 sm:pt-16 sm:pb-12">
        <div className="grid gap-10 lg:grid-cols-12">
          {/* Lede column */}
          <div className="lg:col-span-8">
            <div
              className={cn(
                'text-[10px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--primary))]',
                'animate-in fade-in fill-mode-backwards duration-500 delay-[50ms]'
              )}
            >
              A Circular for Real-Estate Investors
            </div>
            <h1
              className={cn(
                'mt-5 font-[family-name:var(--font-fraunces)] text-[48px] font-medium leading-[0.96] tracking-tight text-foreground sm:text-[68px] md:text-[82px]',
                'animate-in fade-in slide-in-from-bottom-3 fill-mode-backwards duration-700 delay-100',
                '[font-variation-settings:"opsz"_144,"SOFT"_50]'
              )}
            >
              Know what a deal is{' '}
              <em
                className="not-italic bg-gradient-to-r from-[hsl(var(--primary))] via-[hsl(var(--primary))] to-[hsl(var(--primary))]/80 bg-clip-text italic text-transparent"
                style={{ fontStyle: 'italic', fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
              >
                actually worth
              </em>
              <br className="hidden sm:block" />
              {' '}before you write the offer.
            </h1>
            <p
              className={cn(
                'mt-7 max-w-2xl font-[family-name:var(--font-instrument)] text-[17px] leading-[1.6] text-foreground/75',
                'animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards duration-700 delay-200'
              )}
            >
              Paste any US rental property address. Get a complete real estate investment analysis — the{' '}
              <span className="font-semibold text-foreground">exact breakeven offer price</span>,
              {' '}a 5-year wealth projection with IRR, a DSCR stress test, financing alternatives,
              climate and location context, and an AI-written deal diagnosis with
              property-specific negotiation scripts. Start free; unlock the full report when you&apos;re ready.
            </p>

            <div
              className={cn(
                'mt-9 max-w-xl',
                'animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards duration-700 delay-300'
              )}
            >
              <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.2em] text-foreground/55">
                Start with an address
              </p>
              <AddressInput
                onResult={(data) => {
                  setError('')
                  if (data?.autopaid?.entitlement && data?.uuid) {
                    window.location.assign(`/report/${data.uuid}?autopaid=1`)
                    return
                  }
                  setResult(data)
                  setTimeout(() => {
                    document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' })
                  }, 100)
                }}
                onError={(err) => {
                  setError(err)
                  setResult(null)
                }}
              />
            </div>
            {error && (
              <div className="mt-4 max-w-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="mt-6 max-w-xl">
              <LiveCounter />
            </div>
          </div>

          {/* Side column — editorial kicker panel */}
          <aside className="relative lg:col-span-4">
            <div className="sticky top-8 border border-foreground/20 bg-[hsl(var(--card))]/60 p-6 backdrop-blur-sm">
              <div className="flex items-baseline justify-between border-b border-foreground/15 pb-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground/60">
                  The Method
                </span>
                <span className="font-mono text-[10px] tabular-nums text-foreground/50">§ 01</span>
              </div>
              <p className="mt-4 font-[family-name:var(--font-fraunces)] text-[18px] leading-[1.35] text-foreground/90 [font-variation-settings:'opsz'_24,'SOFT'_20]">
                &ldquo;Most deal calculators return cap rate. <em className="text-[hsl(var(--primary))]">DealDoctor returns the
                single price at which this deal breaks even</em> — and what
                you&apos;d leave on the table above it.&rdquo;
              </p>
              <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-foreground/15 pt-5 font-mono tabular-nums">
                <Stat k="TIME TO REPORT" v="~30s" />
                <Stat k="DATA ANCHORS" v="7" />
                <Stat k="REPORT SECTIONS" v="20" />
                <Stat k="LIVE RATE SPREAD" v="+75 bps" />
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* ─── Results Section (injected) ────────────────────────────── */}
      {result && (
        <section id="results" className="relative mx-auto max-w-6xl px-5 pb-16">
          <div className="flex flex-col items-center gap-8">
            <TeaserMetrics teaser={result.teaser} property={result.property} />
            <BlurredReport uuid={result.uuid} address={result.property.address} />
          </div>
        </section>
      )}

      {/* ─── How it works — editorial three-act ────────────────────── */}
      <section className="border-y border-foreground/15 bg-[hsl(var(--card))]/30">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <EditorialHeading eyebrow="How it works" title="Three steps from address to decision." />
          <ol className="mt-10 grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-3">
            {[
              { step: '01', title: 'Paste the investment property address', body: 'An instant free teaser returns the breakeven offer price and where the listing sits relative to it.' },
              { step: '02', title: 'Unlock the full report', body: 'A full underwriting package: the math, AI diagnosis, address-adjacent comps, climate risk, and an interactive rehab estimator.' },
              { step: '03', title: 'Keep analyzing', body: 'Your 5-Pack or Unlimited entitlement applies automatically to every future address — no second paywall.' },
            ].map((s) => (
              <li key={s.step} className="relative border-t border-foreground/30 pt-5">
                <span className="font-mono text-[11px] tabular-nums tracking-widest text-[hsl(var(--primary))]">
                  {s.step}
                </span>
                <h3 className="mt-2 font-[family-name:var(--font-fraunces)] text-[22px] font-semibold leading-tight text-foreground [font-variation-settings:'opsz'_48,'SOFT'_30]">
                  {s.title}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-foreground/70">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ─── Sections I–IV — what's in the report ──────────────────── */}
      <section id="report" className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <EditorialHeading
          eyebrow="The DealDoctor Report"
          title="The full underwriting package."
          dek="Everything a serious investor checks before writing an offer — delivered as one shareable link, documented line by line."
        />

        <div className="mt-14 space-y-20">
          {SECTIONS.map((section) => (
            <div key={section.roman} className="grid gap-8 lg:grid-cols-12">
              {/* Column 1 — section heading */}
              <div className="lg:col-span-4">
                <div className="sticky top-8">
                  <div className="flex items-baseline gap-4 border-b border-foreground/25 pb-3">
                    <span className="font-[family-name:var(--font-fraunces)] text-[38px] font-medium leading-none text-[hsl(var(--primary))] [font-variation-settings:'opsz'_96,'SOFT'_30]">
                      {section.roman}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground/55">
                      {section.label}
                    </span>
                  </div>
                  <p className="mt-5 font-[family-name:var(--font-fraunces)] text-[17px] leading-[1.5] text-foreground/80 [font-variation-settings:'opsz'_24,'SOFT'_50]">
                    {section.lede}
                  </p>
                </div>
              </div>

              {/* Column 2 — items */}
              <div className="lg:col-span-8">
                <div className="grid gap-px bg-foreground/10 border border-foreground/10">
                  {section.items.map((item) => (
                    <article
                      key={item.title}
                      className="group flex gap-5 bg-[hsl(var(--card))] p-5 transition-colors hover:bg-[hsl(var(--card))]/60"
                    >
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center border border-foreground/25 text-foreground/70 transition-colors group-hover:border-[hsl(var(--primary))] group-hover:text-[hsl(var(--primary))]">
                        <item.icon className="h-4 w-4" strokeWidth={1.5} />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-[family-name:var(--font-fraunces)] text-[17px] font-semibold leading-snug text-foreground [font-variation-settings:'opsz'_24,'SOFT'_30]">
                          {item.title}
                        </h3>
                        <p className="mt-1 text-[13.5px] leading-[1.55] text-foreground/70">
                          {item.desc}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Every report — print-style bill-of-materials ──────────── */}
      <section className="border-y border-foreground/15 bg-[hsl(var(--card))]/40">
        <div className="mx-auto max-w-5xl px-5 py-16">
          <EditorialHeading
            eyebrow="Bill of materials"
            title="Identical depth across every tier."
            dek="All three pricing tiers deliver the same report. Only quantity differs."
          />
          <div className="mt-10 columns-1 gap-10 md:columns-2">
            {INCLUDED_IN_EVERY_REPORT.map((item) => (
              <div
                key={item}
                className="mb-2 flex break-inside-avoid items-start gap-3 border-b border-dashed border-foreground/15 pb-2 text-[13.5px] leading-snug text-foreground/85"
              >
                <CheckCircle2Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" strokeWidth={2} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing — horizontal rate card ────────────────────────── */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <EditorialHeading
          eyebrow="Rate card"
          title="Priced for the volume you underwrite."
          dek="Same report in every tier. Pick based on how many deals you're looking at."
        />

        <div className="mt-12 grid grid-cols-1 gap-0 border border-foreground/30 lg:grid-cols-3">
          {[
            {
              name: 'Single Report',
              price: '$24.99',
              per: 'one report',
              tagline: 'Best when you\'re analyzing a specific address.',
                features: [
                  'Full underwriting report',
                  'Breakeven + all underwriting math',
                  'AI deal diagnosis',
                  'Excel + PDF export',
                  'Secure share link + email recovery',
                ],
              },
            {
              name: 'Bundle · 5-Pack',
              price: '$69.99',
              per: '$14.00 per report',
              tagline: 'Best when you\'re shopping a market.',
                features: [
                  '5 reports that stack across searches',
                  'Works cross-device via email recovery',
                  'Everything in Single',
                  'Save to portfolio in this browser',
                  'Best per-report value',
                ],
              popular: true,
            },
            {
              name: 'Pro Unlimited',
              price: '$119.99',
              per: 'per month',
              tagline: 'Best for active investors and agents.',
                features: [
                  'Unlimited reports for 30 days',
                  'Auto-renews monthly · cancel anytime',
                  'Access through the paid period',
                  'Everything in 5-Pack',
                  'Auto-unlocks future searches while active',
                ],
              },
          ].map((tier, i) => (
            <div
              key={tier.name}
              className={cn(
                'relative flex flex-col justify-between bg-[hsl(var(--card))] p-8',
                i > 0 && 'border-t border-foreground/15 lg:border-l lg:border-t-0',
                tier.popular && 'bg-[hsl(var(--background))] ring-1 ring-[hsl(var(--primary))]'
              )}
            >
              {tier.popular && (
                <span className="absolute -top-2.5 left-8 bg-[hsl(var(--primary))] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[hsl(var(--primary-foreground))]">
                  Most chosen
                </span>
              )}

              <div>
                <div className="flex items-baseline justify-between border-b border-foreground/15 pb-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground/60">
                    {tier.name}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-foreground/40">
                    TIER {['I', 'II', 'III'][i]}
                  </span>
                </div>

                <div className="mt-5">
                  <div className="font-[family-name:var(--font-fraunces)] text-[52px] font-medium leading-none tracking-tight text-foreground tabular-nums [font-variation-settings:'opsz'_144]">
                    {tier.price}
                  </div>
                  <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/55">
                    {tier.per}
                  </div>
                </div>

                <p className="mt-5 font-[family-name:var(--font-fraunces)] text-[14.5px] italic leading-snug text-foreground/80 [font-variation-settings:'opsz'_24,'SOFT'_80]">
                  {tier.tagline}
                </p>

                <ul className="mt-6 space-y-2 text-[13.5px] leading-snug text-foreground/80">
                  {tier.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--primary))]" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="mt-8 border-t border-foreground/15 pt-5 text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/55">
                Unlocked after analysis
              </p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/55">
          Secure payment · LemonSqueezy · No account needed · 7-day support & refund review
        </p>
      </section>

      {/* ─── FAQ as editorial Q&A ──────────────────────────────────── */}
      <section id="faq" className="border-t border-foreground/15 bg-[hsl(var(--card))]/30">
        <div className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
          <EditorialHeading eyebrow="Correspondence" title="What readers ask." />

          <div className="mt-10">
            {FAQ.map((item, i) => {
              const open = expandedFaq === i
              return (
                <article key={item.q} className="border-t border-foreground/25 last:border-b">
                  <button
                    onClick={() => setExpandedFaq(open ? null : i)}
                    className="flex w-full items-start gap-5 py-5 text-left"
                    aria-expanded={open}
                  >
                    <span className="mt-1 font-mono text-[11px] tabular-nums tracking-widest text-[hsl(var(--primary))]">
                      Q.{String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="flex-1 font-[family-name:var(--font-fraunces)] text-[19px] font-medium leading-snug text-foreground [font-variation-settings:'opsz'_24,'SOFT'_50]">
                      {item.q}
                    </span>
                    <ChevronDownIcon
                      className={cn(
                        'mt-1.5 h-4 w-4 shrink-0 text-foreground/50 transition-transform duration-300',
                        open && 'rotate-180'
                      )}
                      strokeWidth={1.5}
                    />
                  </button>
                  {open && (
                    <div className="flex gap-5 pb-6 pl-[calc(11px+1.25rem)]">
                      <p className="text-[14.5px] leading-[1.65] text-foreground/75">{item.a}</p>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── Data sources / masthead credits ───────────────────────── */}
      <section className="border-t border-foreground/20 bg-[hsl(var(--background))]">
        <div className="mx-auto max-w-6xl px-5 py-10">
          <div className="grid gap-x-10 gap-y-6 border-t border-foreground/20 pt-10 text-[11px] leading-relaxed md:grid-cols-3">
            <div>
              <div className="font-semibold uppercase tracking-[0.22em] text-foreground">Data</div>
              <div className="mt-2 space-y-1 font-mono tabular-nums text-foreground/70">
                <div>Rentcast · property + comps</div>
                <div>Freddie Mac PMMS · rates</div>
                <div>FEMA NFHL · flood zones</div>
                <div>NAIC · insurance baseline</div>
                <div>Mapbox · location quality</div>
              </div>
            </div>
            <div>
              <div className="font-semibold uppercase tracking-[0.22em] text-foreground">Intelligence</div>
              <div className="mt-2 space-y-1 font-mono tabular-nums text-foreground/70">
                <div>Anthropic</div>
                <div>Breakeven solver</div>
                <div>Sensitivity grid</div>
                <div>Value triangulation</div>
                <div>DSCR &amp; cash-to-close</div>
                <div>Five-year IRR</div>
                <div>Jurisdictional tax</div>
                <div>Invariant gate</div>
              </div>
            </div>
            <div>
              <div className="font-semibold uppercase tracking-[0.22em] text-foreground">Reference</div>
              <div className="mt-2 space-y-1 font-mono tabular-nums text-foreground/70">
                <div><a href="/methodology" className="underline decoration-dotted underline-offset-2 hover:text-foreground">Full methodology</a></div>
                <div><a href="/retrieve" className="underline decoration-dotted underline-offset-2 hover:text-foreground">Retrieve access</a></div>
                <div><a href="/portfolio" className="underline decoration-dotted underline-offset-2 hover:text-foreground">Portfolio</a></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Colophon footer ───────────────────────────────────────── */}
      <footer className="border-t border-foreground/20 bg-[hsl(var(--card))]/30">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-5 py-8 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <Logo variant="wordmark" size="sm" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/50">
              {VOLUME_STAMP}
            </span>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <p className="max-w-xl text-[10.5px] leading-relaxed text-foreground/55">
              Not financial advice. The report is a quantitative aid, not a substitute for professional counsel.
              Always consult a qualified advisor before making investment decisions.
            </p>
            <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/50">
              <a href="/privacy" className="hover:text-foreground transition-colors">Privacy</a>
              <span className="text-foreground/25">·</span>
              <a href="/terms" className="hover:text-foreground transition-colors">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────────

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-foreground/50">{k}</div>
      <div className="mt-1 font-[family-name:var(--font-fraunces)] text-[22px] font-medium leading-none text-foreground [font-variation-settings:'opsz'_48]">
        {v}
      </div>
    </div>
  )
}

function EditorialHeading({
  eyebrow,
  title,
  dek,
}: {
  eyebrow: string
  title: string
  dek?: string
}) {
  return (
    <div className="max-w-3xl">
      <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--primary))]">
        {eyebrow}
      </div>
      <h2 className="mt-3 font-[family-name:var(--font-fraunces)] text-[36px] font-medium leading-[1.05] tracking-tight text-foreground sm:text-[44px] [font-variation-settings:'opsz'_144,'SOFT'_40]">
        {title}
      </h2>
      {dek && (
        <p className="mt-4 max-w-2xl font-[family-name:var(--font-instrument)] text-[15.5px] leading-[1.55] text-foreground/70">
          {dek}
        </p>
      )}
    </div>
  )
}
