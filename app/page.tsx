'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { AddressInput } from '@/components/AddressInput'
import { TeaserMetrics } from '@/components/TeaserMetrics'
import { BlurredReport } from '@/components/BlurredReport'
import { LiveCounter } from '@/components/LiveCounter'
import { Logo } from '@/components/Logo'
import MapPin3D from '@/components/MapPin3D'
import {
  ArrowRightIcon,
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
  DollarSignIcon,
  FileTextIcon,
  TargetIcon,
  CheckCircle2Icon,
  MapPinIcon,
  SparklesIcon,
  PercentIcon,
  WindIcon,
  ChevronDownIcon,
  PrinterIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

const FEATURE_GROUPS = [
  {
    label: 'Underwriting math',
    cards: [
      {
        icon: TargetIcon,
        title: 'Exact Breakeven Offer Price',
        desc: 'Binary-searches the purchase price at which cash flow is ~$0 given today\'s rent and investor rate. Your literal walk-away number.',
      },
      {
        icon: BanknoteIcon,
        title: 'Total Cash to Close',
        desc: 'Down payment + ~2.5% closing + inspection/appraisal + 6-month PITI reserves + rehab. The real "how much do I need?" answer.',
      },
      {
        icon: LineChartIcon,
        title: '5-Year Wealth + Hold IRR',
        desc: 'Cumulative cash flow + principal paydown + appreciation + depreciation tax shield. Includes sale at Y5 with 6% selling costs.',
      },
      {
        icon: LandmarkIcon,
        title: 'Financing Alternatives',
        desc: 'FHA / Conventional investor / DSCR side by side — different down, rate, DSCR, and cash-to-close for each.',
      },
      {
        icon: ActivityIcon,
        title: 'Sensitivity Stress Test',
        desc: 'Rent ±10%, rate +1%, expenses +20%, appreciation 0%/3%/5%. Tornado chart shows which risk carries the most downside.',
      },
    ],
  },
  {
    label: 'Data anchors',
    cards: [
      {
        icon: HomeIcon,
        title: 'Address-Adjacent Sale Comps',
        desc: 'Rentcast sold records within a 1-mile radius of the subject property. With $/sqft and days-on-market.',
      },
      {
        icon: UsersIcon,
        title: 'Rent Comparables',
        desc: 'Nearby rentals our rent estimate was priced against — so you can verify, not just trust, the number driving everything else.',
      },
      {
        icon: BarChart3Icon,
        title: 'Zip-Level Market Growth',
        desc: '12-month price + rent trend from Rentcast, piped directly into the 5-year wealth projection (no flat 3% guess).',
      },
      {
        icon: UmbrellaIcon,
        title: 'Climate + Insurance',
        desc: 'FEMA flood zone lookup + NAIC state insurance baseline + hazard scores. Insurance flows into monthly expenses — Florida hits different.',
      },
      {
        icon: MapPinIcon,
        title: 'Location Quality',
        desc: 'Walkability score + amenity counts (groceries, transit, schools, parks) within ~½ mile, via Mapbox Tilequery.',
      },
    ],
  },
  {
    label: 'AI layer',
    cards: [
      {
        icon: SparklesIcon,
        title: 'Claude Deal Doctor',
        desc: 'Pros, cons, 3 negotiation scripts with specific dollar amounts, and 2 property-specific inspection red flags tied to year built + climate.',
      },
      {
        icon: CameraIcon,
        title: 'Photo Red-Flag Review',
        desc: 'Drop listing photos; Claude Vision flags observable condition concerns — roof, water damage, visible structural — with severity.',
      },
    ],
  },
  {
    label: 'Pro polish',
    cards: [
      {
        icon: WrenchIcon,
        title: 'Interactive Rehab Estimator',
        desc: 'Enter rehab cost + expected rent bump. Every metric — cash flow, DSCR, wealth, IRR — recomputes live as you type.',
      },
      {
        icon: ZapIcon,
        title: 'STR vs LTR Comparison',
        desc: 'Full Airbnb/VRBO P&L with 43% variable opex + STR-specific insurance bump. Verdict chip calls out which strategy wins by $/mo.',
      },
      {
        icon: PercentIcon,
        title: 'State Property-Tax Modeling',
        desc: 'CA Prop 13 2%, TX/FL 6%, per-state reality instead of a flat growth rate. Matters over a 5-year hold in hot-reassessment states.',
      },
      {
        icon: ShieldCheckIcon,
        title: 'Investor-Rate Premium Applied',
        desc: '+75 bps over Freddie Mac PMMS for DSCR/non-owner-occupied loans. The adjustment other calculators silently skip — flips DEAL vs PASS on marginal deals.',
      },
    ],
  },
] as const

const FAQ = [
  {
    q: 'How accurate are the numbers?',
    a: 'The math is exact; the inputs are estimates. AVMs (property value, rent) carry ±10–15% error bars by design. Mortgage math, DSCR, depreciation, and breakeven are deterministic given those inputs. Every data source is cited in the report footer and on the Methodology page — no magic.',
  },
  {
    q: "I lost my report link — what now?",
    a: 'Go to Retrieve access in the nav, enter your email, and we\'ll email you a restore link. Clicking it re-establishes your session on any device — your 5-Pack remaining balance or Unlimited subscription applies automatically.',
  },
  {
    q: 'How do 5-Pack and Unlimited work if there are no accounts?',
    a: 'After purchase, we set a cookie on your browser that maps to your email. Every new address you search is automatically paid for and opens the full report — no re-paywall. On a new device, use the magic-link Retrieve flow to restore access.',
  },
  {
    q: "What's your refund policy?",
    a: "Full refund within 7 days for any reason. Just reply to your receipt email. Cancel Unlimited anytime from LemonSqueezy's portal — you keep access through the period you already paid for.",
  },
  {
    q: 'Can I export to Excel or PDF?',
    a: 'Yes. Every paid report has an Excel export button (8-sheet workbook: Summary, Year-1, 5yr Projection, Sensitivity, Financing Options, Recommended Offers, Comps, Assumptions) and a Print/Save-as-PDF button with an investor-ready print stylesheet.',
  },
  {
    q: 'How is this different from BiggerPockets calculator or DealCheck?',
    a: "Three things: we apply the investor-rate premium over PMMS (they don't), we compute an exact breakeven offer price as the flagship metric, and our AI diagnosis gives property-specific negotiation scripts with dollar amounts — not generic advice. We're also faster for one-off analyses.",
  },
]

const INCLUDED_IN_EVERY_REPORT = [
  'Exact breakeven offer price + three recommended offer tiers',
  'Year-1 metrics: cash flow, DSCR, cap rate, cash-on-cash',
  'Total cash to close (down + closing + reserves + rehab)',
  '5-year wealth projection with IRR and year-by-year table',
  'Financing alternatives (FHA / Conventional / DSCR) side-by-side',
  'Sensitivity stress test (rent, rate, expenses, appreciation) + tornado chart',
  'Rent comparables + address-adjacent sale comparables',
  'Zip-level 12-month price and rent growth',
  'Climate risk (FEMA flood zone) + estimated annual insurance',
  'Location quality (walkability + nearby amenities)',
  'Claude Deal Doctor: pros/cons, 3 negotiation scripts, 2 inspection red flags',
  'STR vs LTR P&L comparison',
  'Interactive rehab estimator with live recompute',
  'Refi stress test (5yr hold at rates from 5% through 8%)',
  'State-specific property tax growth modeling',
  'Photo red-flag AI review (drop listing photos; Claude Vision analyzes)',
  'Excel export (8-sheet workbook) + print-to-PDF',
  'Lender-ready view toggle (hides aggressive assumptions for loan applications)',
  'Save to portfolio for side-by-side comparison across deals',
  'Shareable URL — access forever, recover via email magic-link',
]

export default function LandingPage() {
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0)

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Background atmosphere */}
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
        <div className="absolute top-0 -left-1/4 h-[600px] w-1/2 rounded-full bg-primary/[0.04] blur-[120px]" />
        <div className="absolute bottom-0 -right-1/4 h-[500px] w-1/2 rounded-full bg-primary/[0.03] blur-[100px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_-10%,hsl(var(--primary)/0.06),transparent_50%)]" />
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Logo variant="wordmark" size="md" />
          <div className="flex items-center gap-3 text-sm">
            <a
              href="/retrieve"
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Retrieve access
            </a>
            <a
              href="/portfolio"
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              My Portfolio
            </a>
            <div className="hidden items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-foreground sm:flex">
              <MapPinIcon className="h-3 w-3 text-primary" />
              <span>US</span>
            </div>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-6xl px-4 pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="flex flex-col items-center text-center">
          {/* Animated brand mark */}
          <div
            className={cn(
              'mb-5 text-foreground',
              'animate-in fade-in fill-mode-backwards duration-500'
            )}
          >
            <Logo variant="mark" size="xl" animated />
          </div>

          {/* Badge */}
          <div
            className={cn(
              'mb-6 flex items-center gap-2.5 rounded-full border bg-card px-4 py-1.5 shadow-sm',
              'animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards duration-500 delay-75'
            )}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              Live US mortgage rates · investor-rate premium applied
            </span>
          </div>

          {/* Headline */}
          <h1
            className={cn(
              'max-w-3xl font-[family-name:var(--font-playfair)] text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl md:text-6xl',
              'animate-in fade-in slide-in-from-bottom-6 fill-mode-backwards duration-700 delay-100'
            )}
          >
            Know if a deal is{' '}
            <span className="relative inline-block">
              <span className="relative z-10 text-primary">worth it</span>
              <span className="absolute bottom-1 left-0 -z-0 h-3 w-full bg-primary/15 sm:bottom-2 sm:h-4" />
            </span>
            {' '}before you make an offer
          </h1>

          {/* Subhead */}
          <p
            className={cn(
              'mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg',
              'animate-in fade-in slide-in-from-bottom-6 fill-mode-backwards duration-700 delay-200'
            )}
          >
            Paste any US property address. Get the{' '}
            <span className="font-semibold text-foreground">exact breakeven offer price</span>,
            {' '}5-year wealth projection with IRR, DSCR stress test, financing alternatives,
            climate risk, and a{' '}
            <span className="font-semibold text-foreground">Claude-powered deal diagnosis</span>
            {' '}with specific negotiation scripts. First look free.
          </p>

          {/* Address Input */}
          <div
            className={cn(
              'mt-8 w-full max-w-xl',
              'animate-in fade-in slide-in-from-bottom-6 fill-mode-backwards duration-700 delay-300'
            )}
          >
            <AddressInput
              onResult={(data) => {
                setResult(data)
                setError('')
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
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
              {error}
            </div>
          )}

          <LiveCounter />
        </div>
      </section>

      {/* Results Section */}
      {result && (
        <section id="results" className="relative mx-auto max-w-6xl px-4 pb-16">
          <div className="flex flex-col items-center gap-8">
            <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
              <MapPin3D
                city={result.property.city}
                state={result.property.state}
                address={result.property.address}
              />
            </div>
            <TeaserMetrics teaser={result.teaser} property={result.property} />
            <BlurredReport uuid={result.uuid} address={result.property.address} />
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-8 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            How it works
          </p>
          <h2 className="mt-1 font-[family-name:var(--font-playfair)] text-2xl font-bold text-foreground sm:text-3xl">
            Three steps from address to decision
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              step: '01',
              title: 'Paste the address',
              body: 'Get an instant free teaser with the breakeven offer price and whether the listing sits above or below it.',
            },
            {
              step: '02',
              title: 'Unlock the full report',
              body: '20 sections of underwriting math, AI diagnosis, address-adjacent comps, climate risk, and interactive rehab estimator.',
            },
            {
              step: '03',
              title: 'Keep analyzing',
              body: 'Your 5-Pack or Unlimited entitlement applies automatically to every future search — no second paywall.',
            },
          ].map((s, i) => (
            <div
              key={s.step}
              className={cn(
                'relative rounded-xl border bg-card p-6',
                'animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards duration-500'
              )}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="mb-3 inline-flex h-8 min-w-[2rem] items-center justify-center rounded-md bg-primary/10 px-2 font-[family-name:var(--font-playfair)] text-sm font-bold text-primary">
                {s.step}
              </div>
              <h3 className="text-base font-semibold text-foreground">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features Section — grouped */}
      <section className="border-y bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <div className="mb-10 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              What&apos;s in a DealDoctor report
            </p>
            <h2 className="mt-1 font-[family-name:var(--font-playfair)] text-2xl font-bold text-foreground sm:text-3xl">
              The full underwriting package
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Everything a serious investor checks before writing an offer — in one shareable link.
            </p>
          </div>

          <div className="space-y-10">
            {FEATURE_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                  {group.label}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.cards.map((f) => (
                    <div
                      key={f.title}
                      className={cn(
                        'group rounded-xl border bg-card p-5 transition-all duration-300',
                        'hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20'
                      )}
                    >
                      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/15">
                        <f.icon className="h-4 w-4 text-primary" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">{f.title}</h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        {f.desc}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Everything in every report */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
        <div className="mb-8 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Every tier, same report
          </p>
          <h2 className="mt-1 font-[family-name:var(--font-playfair)] text-2xl font-bold text-foreground sm:text-3xl">
            Everything included in every report
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            All three pricing tiers deliver the identical report — only quantity differs.
          </p>
        </div>

        <div className="mx-auto max-w-3xl rounded-2xl border bg-card p-6 sm:p-8">
          <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {INCLUDED_IN_EVERY_REPORT.map((item) => (
              <li key={item} className="flex items-start gap-2 py-1">
                <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="text-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pricing CTA */}
      <section id="pricing" className="border-t bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <div className="text-center">
            <h2 className="font-[family-name:var(--font-playfair)] text-3xl font-bold text-foreground sm:text-4xl">
              Simple pricing for every investor
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Same report depth across tiers. Pick based on how many deals you&apos;re analyzing.
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              {
                name: 'Single Report',
                price: '$8.99',
                per: 'one report',
                tagline: 'Best if analyzing one deal',
                features: [
                  'Full 20-section report',
                  'Breakeven + all underwriting math',
                  'Claude Deal Doctor diagnosis',
                  'Excel + PDF export',
                  'Shareable URL — access forever',
                ],
              },
              {
                name: 'Bundle 5-Pack',
                price: '$28.99',
                per: '$5.80/report',
                tagline: 'Best if shopping a market',
                features: [
                  '5 reports that stack across searches',
                  'Works cross-device via email recovery',
                  'Everything in Single',
                  'Save to portfolio for side-by-side comparison',
                  'Best per-report value',
                ],
                popular: true,
              },
              {
                name: 'Pro Unlimited',
                price: '$48.99',
                per: 'per month',
                tagline: 'Best for active investors',
                features: [
                  'Unlimited reports for 30 days',
                  'Auto-renews monthly · cancel anytime',
                  'Access kept through paid-and-cancelled periods',
                  'Everything in 5-Pack',
                  'Priority AI generation',
                ],
              },
            ].map((tier) => (
              <div
                key={tier.name}
                className={cn(
                  'relative rounded-2xl border bg-card p-6',
                  tier.popular
                    ? 'border-2 border-primary shadow-lg shadow-primary/10'
                    : 'border-border'
                )}
              >
                {tier.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                    Most Popular
                  </span>
                )}
                <p className="text-sm font-semibold text-muted-foreground">{tier.name}</p>
                <div className="mt-2 flex items-baseline justify-center gap-1">
                  <span className="text-4xl font-bold text-foreground">{tier.price}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{tier.per}</p>
                <p className="mt-3 text-xs font-medium text-primary">{tier.tagline}</p>

                <div className="mt-5 space-y-2 text-left text-sm">
                  {tier.features.map((f) => (
                    <div key={f} className="flex items-start gap-2">
                      <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="text-foreground">{f}</span>
                    </div>
                  ))}
                </div>

                <Button
                  size="lg"
                  variant={tier.popular ? 'default' : 'outline'}
                  className={cn(
                    'mt-6 w-full gap-2 font-bold',
                    tier.popular && 'shadow-lg shadow-primary/25'
                  )}
                  onClick={() => {
                    document.querySelector('input')?.focus()
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                >
                  Get Started
                  <ArrowRightIcon className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Secure payment via LemonSqueezy · No account needed · 7-day refund if the report
            isn&apos;t useful
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-14 sm:py-20">
        <div className="mb-8 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            FAQ
          </p>
          <h2 className="mt-1 font-[family-name:var(--font-playfair)] text-2xl font-bold text-foreground sm:text-3xl">
            Common questions
          </h2>
        </div>

        <div className="divide-y divide-border rounded-xl border bg-card">
          {FAQ.map((item, i) => {
            const open = expandedFaq === i
            return (
              <div key={item.q}>
                <button
                  onClick={() => setExpandedFaq(open ? null : i)}
                  className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/30"
                  aria-expanded={open}
                >
                  <span className="flex-1 text-sm font-semibold text-foreground">{item.q}</span>
                  <ChevronDownIcon
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                      open && 'rotate-180'
                    )}
                  />
                </button>
                {open && (
                  <div className="px-5 pb-4">
                    <p className="text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Data sources row */}
      <section className="border-t bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-8 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          <span className="text-[10px] font-semibold tracking-[0.25em] text-foreground">
            Powered by
          </span>
          <span>Rentcast</span>
          <span className="text-muted-foreground/30">·</span>
          <span>FEMA NFHL</span>
          <span className="text-muted-foreground/30">·</span>
          <span>Freddie Mac PMMS</span>
          <span className="text-muted-foreground/30">·</span>
          <span>NAIC</span>
          <span className="text-muted-foreground/30">·</span>
          <span>Mapbox</span>
          <span className="text-muted-foreground/30">·</span>
          <span>Anthropic Claude</span>
          <a
            href="/methodology"
            className="ml-2 rounded-full border border-border/60 px-3 py-1 font-medium text-foreground normal-case tracking-normal transition-colors hover:bg-muted"
          >
            Full methodology →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-card/30">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <Logo variant="wordmark" size="sm" />
            <div className="flex flex-col items-center gap-1 sm:items-end">
              <a
                href="/methodology"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Methodology &amp; data sources
              </a>
              <p className="text-xs text-muted-foreground">
                Not financial advice. Always consult a qualified professional before making
                investment decisions.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
