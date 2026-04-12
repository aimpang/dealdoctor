'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { LockIcon, ArrowRightIcon, ZapIcon, FileTextIcon, ShieldCheckIcon, StarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
    desc: '$5.80/report',
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

export function BlurredReport({ uuid, address }: BlurredReportProps) {
  const [loading, setLoading] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState('single')

  const handleUnlock = async (plan: string) => {
    setLoading(true)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid, plan }),
      })
      const data = await res.json()
      if (data.alreadyPaid) {
        window.location.href = data.url
      } else if (data.url) {
        window.location.href = data.url
      }
    } catch {
      setLoading(false)
    }
  }

  return (
    <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border bg-card">
      {/* Fake blurred report content */}
      <div className="relative p-6 sm:p-8">
        <div className="select-none blur-[6px] pointer-events-none" aria-hidden="true">
          <div className="mb-6 space-y-3">
            <div className="h-5 w-48 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted/60" />
            <div className="h-3 w-3/4 rounded bg-muted/60" />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4">
                <div className="h-3 w-20 rounded bg-muted/50 mb-2" />
                <div className="h-6 w-24 rounded bg-muted" />
                <div className="h-2 w-16 rounded bg-muted/40 mt-2" />
              </div>
            ))}
          </div>
          <div className="mt-6 space-y-2">
            <div className="h-4 w-36 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted/50" />
            <div className="h-3 w-5/6 rounded bg-muted/50" />
            <div className="h-3 w-4/6 rounded bg-muted/50" />
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4">
                <div className="h-4 w-20 rounded bg-muted mb-3" />
                <div className="h-8 w-28 rounded bg-primary/20" />
                <div className="h-2 w-16 rounded bg-muted/40 mt-2" />
              </div>
            ))}
          </div>
        </div>

        {/* Unlock overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-card/40 via-card/80 to-card">
          <div className="flex w-full max-w-lg flex-col items-center gap-5 px-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-4 ring-primary/5">
              <LockIcon className="h-6 w-6 text-primary" />
            </div>

            <div>
              <h3 className="font-[family-name:var(--font-playfair)] text-xl font-bold text-foreground sm:text-2xl">
                Unlock Full Report
              </h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Complete investment analysis for{' '}
                <span className="font-medium text-foreground">{address}</span>
              </p>
            </div>

            {/* Plan selector */}
            <div className="grid w-full grid-cols-3 gap-2">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id)}
                  className={cn(
                    "relative rounded-xl border p-3 text-left transition-all duration-200",
                    selectedPlan === plan.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  {plan.popular && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                      <StarIcon className="h-2.5 w-2.5" />
                      Best Value
                    </span>
                  )}
                  <p className="text-lg font-bold text-foreground">{plan.price}</p>
                  <p className="text-xs font-semibold text-foreground">{plan.name}</p>
                  <p className="text-[10px] text-muted-foreground">{plan.desc}</p>
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <ZapIcon className="h-3.5 w-3.5 text-primary" />
                <span>Claude-powered Deal Doctor diagnosis</span>
              </div>
              <div className="flex items-center gap-2">
                <FileTextIcon className="h-3.5 w-3.5 text-primary" />
                <span>DSCR, refi scenarios, depreciation benefits</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className="h-3.5 w-3.5 text-primary" />
                <span>Shareable URL — access anytime, forever</span>
              </div>
            </div>

            <Button
              onClick={() => handleUnlock(selectedPlan)}
              disabled={loading}
              size="lg"
              className={cn(
                "w-full gap-2 text-base font-bold",
                "shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30",
                "transition-all duration-200 active:scale-95"
              )}
            >
              {loading ? 'Redirecting...' : `Get Full Report — ${plans.find(p => p.id === selectedPlan)?.price}`}
              <ArrowRightIcon className="h-4 w-4" />
            </Button>

            <div className="flex flex-col items-center gap-1.5 text-[11px] text-muted-foreground/70">
              <p>Secure checkout via LemonSqueezy &middot; Instant delivery</p>
              <p>
                <span className="font-semibold text-foreground">Not useful?</span>{' '}
                Email us within 7 days for a full refund — no questions asked.
              </p>
              {/* Dev-only shortcut. process.env.NODE_ENV is inlined at build time,
                  so this whole block tree-shakes out of production bundles. */}
              {process.env.NODE_ENV !== 'production' && (
                <a
                  href={`/report/${uuid}?debug=1`}
                  className="mt-2 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-1 font-mono text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                >
                  🔧 DEV: view full report (bypass paywall) →
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
