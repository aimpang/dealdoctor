'use client'

import { AlertTriangleIcon, LockIcon } from 'lucide-react'

interface TeaserWarning { code: string; message: string }

interface TeaserMetricsProps {
  teaser: {
    estimatedValue: number
    listingPrice?: number
    estimatedRent: number
    breakevenPrice: number
    listingVsBreakeven: number
    city: string
    state: string
    bedrooms: number
    bathrooms: number
    sqft: number
    yearBuilt: number
    currentRate: number
    valueSource?: 'avm' | 'listing' | 'tax-assessment' | 'last-sale-grown' | 'unknown'
    valueRangeLow?: number
    valueRangeHigh?: number
    rentRangeLow?: number
    rentRangeHigh?: number
    perBedroomRent?: number | null
    rentMultiplied?: boolean
    rentMultipliedBy?: number | null
    rentMultiplierReason?: 'subdivision-match' | 'yield-anomaly' | null
    warnings?: TeaserWarning[]
  }
  property: {
    address: string
    city: string
    state: string
    type: string
    bedrooms: number
    bathrooms: number
  }
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

export function TeaserMetrics({ teaser, property }: TeaserMetricsProps) {
  const warnings = teaser.warnings ?? []

  return (
    <div className="w-full max-w-3xl">
      {/* Address header — editorial eyebrow + Fraunces heading, no rounded chrome */}
      <div className="mb-5 border-b border-foreground/15 pb-4 text-center">
        <div className="flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground/60">
          <span>Instant Analysis</span>
          <span className="font-mono text-foreground/40">§ 02</span>
        </div>
        <h3 className="mt-2 font-[family-name:var(--font-fraunces)] text-[22px] font-medium leading-tight text-foreground [font-variation-settings:'opsz'_48,'SOFT'_30]">
          {property.address}
        </h3>
      </div>

      {/* Data-quality warnings — rectangular amber band, matches editorial border style */}
      {warnings.length > 0 && (
        <div className="mb-5 space-y-2">
          {warnings.map((w) => (
            <div
              key={w.code}
              className="flex items-start gap-2 border border-amber-500/40 bg-amber-500/5 px-4 py-3"
            >
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs leading-relaxed text-foreground/80">{w.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Four stat tiles — matches "The Method" stat grid: mono tabular, uppercase labels,
          straight dividers. No lucide icons, no rounded corners, no backgrounds. */}
      <div className="grid grid-cols-2 border border-foreground/20 bg-[hsl(var(--card))]/60 backdrop-blur-sm sm:grid-cols-4">
        <StatCell
          label="Est. Value"
          value={fmt(teaser.estimatedValue)}
          sub={`${property.bedrooms === 0 ? 'Studio' : `${property.bedrooms}bd`} / ${property.bathrooms}ba${teaser.sqft ? ` / ${teaser.sqft.toLocaleString()} sqft` : ''}`}
          locked
        />
        <StatCell
          label="Est. Rent"
          value={`${fmt(teaser.estimatedRent)}/mo`}
          sub={teaser.yearBuilt ? `Built ${teaser.yearBuilt}` : `${property.city}, ${property.state}`}
          locked
        />
        <StatCell
          label="Breakeven"
          value={fmt(teaser.breakevenPrice)}
          sub="Cash-flows at ~$0/mo"
          accent
        />
        <StatCell
          label="Investor Rate"
          value={`${(teaser.currentRate * 100).toFixed(2)}%`}
          sub="PMMS + DSCR premium"
        />
      </div>
    </div>
  )
}

function StatCell({
  label,
  value,
  sub,
  accent,
  locked,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
  locked?: boolean
}) {
  return (
    <div className="border-b border-foreground/15 px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 [&:nth-child(2)]:border-b sm:[&:nth-child(2)]:border-b-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/55">
        {label}
      </p>
      {locked ? (
        <div className="relative mt-1.5 h-[26px]">
          <span
            aria-hidden
            className="pointer-events-none select-none font-mono text-[20px] font-semibold tabular-nums text-foreground/50 blur-[5px]"
          >
            {value}
          </span>
          <span className="absolute inset-0 flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/75">
            <LockIcon className="h-3 w-3" />
            Unlock
          </span>
        </div>
      ) : (
        <p
          className={
            accent
              ? 'mt-1.5 font-mono text-[20px] font-semibold tabular-nums text-[hsl(var(--primary))]'
              : 'mt-1.5 font-mono text-[20px] font-semibold tabular-nums text-foreground'
          }
        >
          {value}
        </p>
      )}
      {sub && <p className="mt-1 text-[11px] leading-snug text-foreground/55">{sub}</p>}
    </div>
  )
}
