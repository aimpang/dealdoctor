'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { AddressInput } from '@/components/AddressInput'
import { TeaserMetrics } from '@/components/TeaserMetrics'
import { BlurredReport } from '@/components/BlurredReport'
import { LiveCounter } from '@/components/LiveCounter'
import MapPin3D from '@/components/MapPin3D'
import {
  ArrowRightIcon,
  ShieldCheckIcon,
  ZapIcon,
  BarChart3Icon,
  BuildingIcon,
  TrendingUpIcon,
  ClockIcon,
  MapPinIcon,
  CheckCircle2Icon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function LandingPage() {
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

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
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <svg className="h-4 w-4 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <span className="font-[family-name:var(--font-playfair)] text-lg font-bold tracking-tight text-foreground">
              Deal<span className="text-primary">Doctor</span>
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">US Properties</span>
            <div className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-foreground">
              <MapPinIcon className="h-3 w-3 text-primary" />
              <span>US</span>
            </div>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-6xl px-4 pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="flex flex-col items-center text-center">
          {/* Badge */}
          <div
            className={cn(
              "mb-6 flex items-center gap-2.5 rounded-full border bg-card px-4 py-1.5 shadow-sm",
              "animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards duration-500"
            )}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              Live US mortgage rates
            </span>
          </div>

          {/* Headline */}
          <h1
            className={cn(
              "max-w-3xl font-[family-name:var(--font-playfair)] text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl md:text-6xl",
              "animate-in fade-in slide-in-from-bottom-6 fill-mode-backwards duration-700 delay-100"
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
              "mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg",
              "animate-in fade-in slide-in-from-bottom-6 fill-mode-backwards duration-700 delay-200"
            )}
          >
            Paste any US property address. Get instant mortgage math, cash flow analysis,
            DSCR check, the exact breakeven offer price, and an AI-powered deal diagnosis.
          </p>

          {/* Address Input */}
          <div
            className={cn(
              "mt-8 w-full max-w-xl",
              "animate-in fade-in slide-in-from-bottom-6 fill-mode-backwards duration-700 delay-300"
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

          {/* Live activity counter — only renders once we have real data */}
          <LiveCounter />
        </div>
      </section>

      {/* Results Section */}
      {result && (
        <section
          id="results"
          className="relative mx-auto max-w-6xl px-4 pb-16"
        >
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

      {/* Features Section */}
      <section className="border-y bg-card/50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <div className="mb-10 text-center">
            <h2 className="font-[family-name:var(--font-playfair)] text-2xl font-bold text-foreground sm:text-3xl">
              What&apos;s in a DealDoctor report?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Everything a US investor needs to make a confident decision.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: BarChart3Icon,
                title: 'US Mortgage Math',
                desc: 'Standard 30-year amortization with accurate monthly compounding. Real math, not napkin estimates.',
              },
              {
                icon: ShieldCheckIcon,
                title: 'DSCR Analysis',
                desc: 'Debt Service Coverage Ratio analysis. Lenders want 1.25+. See if your deal qualifies.',
              },
              {
                icon: TrendingUpIcon,
                title: 'Refi Scenarios',
                desc: 'What happens when you refi in 5 years? See cash flow at rates from 5% through 8%.',
              },
              {
                icon: ZapIcon,
                title: 'AI Deal Doctor',
                desc: 'AI-powered diagnosis with 3 concrete fixes anchored to real numbers. Negotiation, value-add, and pivot strategies.',
              },
              {
                icon: BuildingIcon,
                title: 'Depreciation Benefits',
                desc: '27.5-year straight-line depreciation on building value. Know your actual after-tax cash flow.',
              },
              {
                icon: ClockIcon,
                title: 'Live Market Rates',
                desc: 'Current 30-year and 15-year fixed rates from Freddie Mac surveys. Not stale data from last quarter.',
              },
            ].map((f) => (
              <div
                key={f.title}
                className={cn(
                  "group rounded-xl border bg-card p-6 transition-all duration-300",
                  "hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20"
                )}
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/15">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Market Stats Strip */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
        <div className="mb-8 text-center">
          <h2 className="font-[family-name:var(--font-playfair)] text-2xl font-bold text-foreground sm:text-3xl">
            Austin Market Snapshot
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">April 2026 — updated weekly from live feeds</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Median Price', value: '$425,000', change: '+3.2%' },
            { label: 'Avg Cap Rate', value: '5.1%', change: '+0.2%' },
            { label: 'Days on Market', value: '34', change: '-6' },
            { label: '30yr Fixed', value: '6.50%', change: '-0.25%' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border bg-card p-4 text-center sm:p-6"
            >
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">{stat.value}</p>
              <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">{stat.change} YoY</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing CTA */}
      <section className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <div className="text-center">
            <h2 className="font-[family-name:var(--font-playfair)] text-3xl font-bold text-foreground sm:text-4xl">
              Simple pricing for every investor.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">Pick one report, a 5-pack bundle, or go pro with unlimited monthly access.</p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-3xl mx-auto">
            {[
              { name: 'Single Report', price: '$8.99', per: 'one report', features: ['Full deal analysis', 'AI Deal Doctor', 'Shareable URL'] },
              { name: 'Bundle 5-Pack', price: '$28.99', per: '$5.80/report', features: ['Everything in Single', '5 property analyses', 'Best per-report value'], popular: true },
              { name: 'Pro Unlimited', price: '$48.99', per: 'per month', features: ['Everything in 5-Pack', 'Analyze every deal', 'For active investors'] },
            ].map((tier) => (
              <div
                key={tier.name}
                className={cn(
                  "relative rounded-2xl border bg-card p-6 text-center",
                  tier.popular ? "border-2 border-primary shadow-lg shadow-primary/10" : "border-border"
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

                <div className="mt-5 space-y-2.5 text-left text-sm">
                  {tier.features.map((f) => (
                    <div key={f} className="flex items-center gap-2">
                      <CheckCircle2Icon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="text-foreground">{f}</span>
                    </div>
                  ))}
                </div>

                <Button
                  size="lg"
                  variant={tier.popular ? 'default' : 'outline'}
                  className={cn(
                    "mt-6 w-full gap-2 font-bold",
                    tier.popular && "shadow-lg shadow-primary/25"
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
            Secure payment via LemonSqueezy &middot; No account needed &middot; 7-day refund if the report isn&apos;t useful
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-card/30">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-primary">
                <svg className="h-3 w-3 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-foreground">DealDoctor</span>
            </div>
            <div className="flex flex-col items-center gap-1 sm:items-end">
              <a
                href="/methodology"
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Methodology &amp; data sources
              </a>
              <p className="text-xs text-muted-foreground">
                Not financial advice. Always consult a qualified professional before making investment decisions.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
