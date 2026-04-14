'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { LockIcon, ArrowRightIcon } from 'lucide-react'

interface BlurredReportProps {
  uuid: string
  address: string
}

const plans = [
  {
    id: 'single',
    name: 'Single Report',
    price: '$8.99',
    desc: 'This property',
    popular: false,
  },
  {
    id: '5pack',
    name: 'Bundle 5-Pack',
    price: '$28.99',
    desc: '$5.80 / report',
    popular: true,
  },
  {
    id: 'unlimited',
    name: 'Pro Unlimited',
    price: '$48.99',
    desc: 'per month',
    popular: false,
  },
]

const FEATURES = [
  'Exact breakeven offer price + 3 recommended offer tiers',
  '5-year wealth + IRR, sensitivity stress test, financing alternatives',
  'Claude diagnosis with negotiation scripts + inspection red flags',
  'Climate, comps, walkability + Excel & PDF export',
]

export function BlurredReport({ uuid, address }: BlurredReportProps) {
  const [loading, setLoading] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState('single')
  const [checkoutError, setCheckoutError] = useState<{
    message: string
    retryable: boolean
    supportContact?: string
  } | null>(null)

  const handleUnlock = async (plan: string) => {
    setLoading(true)
    setCheckoutError(null)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid, plan }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCheckoutError({
          message: data.error || 'Checkout failed. Please try again.',
          retryable: data.retryable ?? true,
          supportContact: data.supportContact,
        })
        return
      }
      if (data.alreadyPaid || data.url) {
        window.location.href = data.url
      }
    } catch {
      setCheckoutError({
        message: 'Network error — check your connection and try again.',
        retryable: true,
        supportContact: 'support@dealdoctor.app',
      })
    } finally {
      setLoading(false)
    }
  }

  const selected = plans.find((p) => p.id === selectedPlan)

  return (
    <div className="relative w-full max-w-3xl overflow-hidden border border-foreground/20 bg-[hsl(var(--card))]/60 backdrop-blur-sm">
      {/* Blurred skeleton — rectangular, matches editorial grid vibe */}
      <div className="relative p-6 sm:p-8">
        <div className="select-none blur-[6px] pointer-events-none" aria-hidden="true">
          <div className="mb-6 space-y-3">
            <div className="h-5 w-48 bg-muted" />
            <div className="h-3 w-full bg-muted/60" />
            <div className="h-3 w-3/4 bg-muted/60" />
          </div>
          <div className="grid grid-cols-2 border border-foreground/15 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border-b border-r border-foreground/15 p-4 last:border-r-0">
                <div className="h-3 w-20 bg-muted/50 mb-2" />
                <div className="h-6 w-24 bg-muted" />
                <div className="h-2 w-16 bg-muted/40 mt-2" />
              </div>
            ))}
          </div>
          <div className="mt-6 space-y-2">
            <div className="h-4 w-36 bg-muted" />
            <div className="h-3 w-full bg-muted/50" />
            <div className="h-3 w-5/6 bg-muted/50" />
            <div className="h-3 w-4/6 bg-muted/50" />
          </div>
        </div>

        {/* Unlock overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[hsl(var(--card))]/40 via-[hsl(var(--card))]/85 to-[hsl(var(--card))]">
          <div className="flex w-full max-w-lg flex-col items-center gap-5 px-4 text-center">
            {/* Eyebrow + section mark, matches landing */}
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--primary))]">
              <LockIcon className="h-3 w-3" />
              <span>Full Report Locked</span>
              <span className="font-mono text-foreground/40">§ 03</span>
            </div>

            <div>
              <h3 className="font-[family-name:var(--font-fraunces)] text-[32px] font-medium leading-[1.05] tracking-tight text-foreground [font-variation-settings:'opsz'_72,'SOFT'_40] sm:text-[38px]">
                Unlock the full{' '}
                <em
                  className="not-italic bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--primary))]/80 bg-clip-text italic text-transparent"
                  style={{ fontStyle: 'italic', fontVariationSettings: '"opsz" 72, "SOFT" 80' }}
                >
                  underwriting
                </em>
                .
              </h3>
              <p className="mt-2 font-[family-name:var(--font-instrument)] text-[14px] leading-[1.6] text-foreground/70">
                Complete investment analysis for{' '}
                <span className="font-semibold text-foreground">{address}</span>
              </p>
            </div>

            {/* Plan selector — rectangular tiles with mono prices, matches Stat panel style */}
            <div className="grid w-full grid-cols-3 border border-foreground/20">
              {plans.map((plan, i) => (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id)}
                  className={cn(
                    'relative p-3 text-left transition-colors',
                    i > 0 && 'border-l border-foreground/20',
                    selectedPlan === plan.id
                      ? 'bg-[hsl(var(--primary))]/8 ring-1 ring-inset ring-[hsl(var(--primary))]'
                      : 'hover:bg-foreground/[0.03]'
                  )}
                >
                  {plan.popular && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-[hsl(var(--primary))] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-primary-foreground">
                      Best Value
                    </span>
                  )}
                  <p className="font-mono text-[17px] font-semibold tabular-nums text-foreground">
                    {plan.price}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/80">
                    {plan.name}
                  </p>
                  <p className="text-[10px] text-foreground/55">{plan.desc}</p>
                </button>
              ))}
            </div>

            {/* Feature list — straight rules, no chip icons, mono section markers */}
            <ul className="w-full space-y-2 border-t border-foreground/15 pt-4 text-left">
              {FEATURES.map((f, i) => (
                <li key={i} className="flex items-start gap-3 text-[13px] leading-snug text-foreground/75">
                  <span className="mt-[3px] font-mono text-[10px] tabular-nums tracking-widest text-[hsl(var(--primary))]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => handleUnlock(selectedPlan)}
              disabled={loading}
              className={cn(
                'group flex w-full items-center justify-center gap-2 border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-5 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.18em] text-primary-foreground transition-colors',
                'hover:bg-[hsl(var(--primary))]/90',
                'disabled:opacity-60 disabled:cursor-not-allowed'
              )}
            >
              {loading
                ? 'Redirecting…'
                : `Get Full Report — ${selected?.price}`}
              {!loading && <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
            </button>

            {checkoutError && (
              <div
                role="alert"
                className="w-full border border-destructive/40 bg-destructive/5 px-4 py-3 text-left"
              >
                <p className="text-sm font-semibold text-foreground">Checkout couldn&apos;t start</p>
                <p className="mt-0.5 text-xs text-foreground/65">{checkoutError.message}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {checkoutError.retryable && (
                    <button
                      type="button"
                      onClick={() => handleUnlock(selectedPlan)}
                      disabled={loading}
                      className="border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-primary-foreground hover:bg-[hsl(var(--primary))]/90 disabled:opacity-50"
                    >
                      Try again
                    </button>
                  )}
                  {checkoutError.supportContact && (
                    <a
                      href={`mailto:${checkoutError.supportContact}?subject=${encodeURIComponent(
                        `Checkout failed for report ${uuid}`
                      )}`}
                      className="border border-foreground/20 bg-[hsl(var(--card))] px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-foreground hover:bg-foreground/5"
                    >
                      Contact support
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col items-center gap-1.5 border-t border-foreground/10 pt-3 text-[11px] text-foreground/55">
              <p>
                <span className="font-mono uppercase tracking-[0.15em] text-foreground/70">Secure</span>{' '}
                checkout via LemonSqueezy &middot; Instant delivery
              </p>
              <p>
                <span className="font-semibold text-foreground">Not useful?</span>{' '}
                Email within 7 days for a full refund — no questions asked.
              </p>
              {process.env.NODE_ENV !== 'production' && (
                <a
                  href={`/report/${uuid}?debug=1`}
                  className="mt-2 border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                >
                  DEV: view full report (bypass paywall) →
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
