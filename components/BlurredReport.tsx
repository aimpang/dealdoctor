'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { LockIcon, ArrowRightIcon, ShieldCheckIcon, ZapIcon, FileTextIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BlurredReportProps {
  uuid: string
  address: string
}

export function BlurredReport({ uuid, address }: BlurredReportProps) {
  const [loading, setLoading] = useState(false)

  const handleUnlock = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid }),
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
          <div className="flex max-w-sm flex-col items-center gap-5 px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-4 ring-primary/5">
              <LockIcon className="h-6 w-6 text-primary" />
            </div>

            <div>
              <h3 className="font-[family-name:var(--font-playfair)] text-xl font-bold text-foreground sm:text-2xl">
                Unlock Full Report
              </h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Complete investment analysis for<br />
                <span className="font-medium text-foreground">{address}</span>
              </p>
            </div>

            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <ZapIcon className="h-3.5 w-3.5 text-primary" />
                <span>AI-powered Deal Doctor diagnosis</span>
              </div>
              <div className="flex items-center gap-2">
                <FileTextIcon className="h-3.5 w-3.5 text-primary" />
                <span>Stress test, renewal scenarios, CCA tax benefits</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className="h-3.5 w-3.5 text-primary" />
                <span>Shareable URL - access anytime, forever</span>
              </div>
            </div>

            <Button
              onClick={handleUnlock}
              disabled={loading}
              size="lg"
              className={cn(
                "w-full gap-2 text-base font-bold",
                "shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30",
                "transition-all duration-200 active:scale-95"
              )}
            >
              {loading ? 'Redirecting...' : 'Get Full Report — $14.99 USD'}
              <ArrowRightIcon className="h-4 w-4" />
            </Button>

            <p className="text-[11px] text-muted-foreground/60">
              One-time payment &middot; Secure checkout &middot; Instant delivery
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
