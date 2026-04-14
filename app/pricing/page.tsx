import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/Logo'
import { absoluteUrl } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Pricing — DealDoctor Reports from $24.99',
  description:
    'DealDoctor pricing: $24.99 single report, $69.99 for 5 reports, $119.99/mo unlimited. Full 20-section real estate investment analysis with 7-day refund.',
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Pricing — DealDoctor Reports from $24.99',
    description:
      'Single reports, 5-pack bundles, and unlimited monthly plans for real estate investment analysis.',
    url: absoluteUrl('/pricing'),
    type: 'website',
  },
}

const TIERS = [
  {
    name: 'Single Report',
    price: '$24.99',
    per: 'per report',
    tagline: 'Best when you\'re weighing one specific deal.',
    features: [
      'Full 20-section underwriting report',
      'Exact breakeven offer price + offer tiers',
      '5-year wealth projection & IRR',
      'AI Deal Doctor diagnosis',
      'Excel export & print PDF',
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
      'Save to portfolio for side-by-side',
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
      'Priority AI generation',
    ],
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-foreground">
      <header className="border-b border-foreground/20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Link href="/">
            <Logo variant="wordmark" size="md" />
          </Link>
          <nav className="flex items-center gap-7 text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/80">
            <Link href="/" className="hover:text-foreground">Home</Link>
            <Link href="/methodology" className="hover:text-foreground">Methodology</Link>
            <Link href="/retrieve" className="hover:text-foreground">Retrieve</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <div className="mb-12 text-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-[hsl(var(--primary))]">Rate card</span>
          <h1 className="mt-4 font-[family-name:var(--font-fraunces)] text-[42px] font-medium leading-[1.05] tracking-tight sm:text-[56px] [font-variation-settings:'opsz'_144,'SOFT'_50]">
            Priced for the volume you underwrite.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl font-[family-name:var(--font-instrument)] text-[17px] leading-[1.6] text-foreground/75">
            One-time reports, a 5-pack bundle, or unlimited for a month. Every tier gets the complete 20-section investment property analysis — no feature gates, no upsells inside the report.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 border border-foreground/15 bg-[hsl(var(--card))]/30">
          {TIERS.map((tier, i) => (
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
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground/60">{tier.name}</span>
                  <span className="font-mono text-[10px] tabular-nums text-foreground/40">TIER {['I', 'II', 'III'][i]}</span>
                </div>
                <div className="mt-5">
                  <div className="font-[family-name:var(--font-fraunces)] text-[52px] font-medium leading-none tracking-tight tabular-nums [font-variation-settings:'opsz'_144]">
                    {tier.price}
                  </div>
                  <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/55">{tier.per}</div>
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
              <Link
                href="/"
                className={cn(
                  'mt-8 inline-flex w-full items-center justify-center gap-2 px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.15em] transition-colors',
                  tier.popular
                    ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90'
                    : 'border border-foreground/40 bg-transparent text-foreground hover:bg-foreground hover:text-[hsl(var(--background))]'
                )}
              >
                Start Analysis
                <ArrowRightIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/55">
          Secure payment · LemonSqueezy · No account needed · 7-day refund
        </p>
      </section>
    </div>
  )
}
