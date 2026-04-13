'use client'

import { cn } from '@/lib/utils'
import { TrendingUpIcon, HomeIcon, TargetIcon, PercentIcon, AlertTriangleIcon } from 'lucide-react'

interface TeaserWarning { code: string; message: string }

interface TeaserMetricsProps {
  teaser: {
    estimatedValue: number
    estimatedRent: number
    breakevenPrice: number
    listingVsBreakeven: number // positive = listing below breakeven; negative = above
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

const valueSourceLabel = (s?: string): string => {
  switch (s) {
    case 'listing': return 'Active listing price'
    case 'avm': return 'Rentcast AVM estimate'
    case 'tax-assessment': return 'From tax assessment'
    case 'last-sale-grown': return 'Grown from last sale'
    default: return 'Estimated'
  }
}

// When the value isn't an actual listing, "Listing is above/below breakeven"
// is misleading. Use accurate wording based on where the value came from.
const valueNounFor = (s?: string): string => {
  if (s === 'listing') return 'Listing'
  return 'Est. value'
}

export function TeaserMetrics({ teaser, property }: TeaserMetricsProps) {
  const listingAbove = teaser.listingVsBreakeven < 0
  const valueNoun = valueNounFor(teaser.valueSource)
  const warnings = teaser.warnings ?? []

  return (
    <div className="w-full max-w-3xl">
      <div className="mb-4 text-center">
        <p className="text-sm font-medium text-muted-foreground">Instant analysis for</p>
        <h3 className="font-[family-name:var(--font-playfair)] text-lg font-semibold text-foreground">
          {property.address}
        </h3>
      </div>

      {/* Data-quality warnings BEFORE the hero so buyers see them pre-paywall.
          Amber band, stacked if multiple. Ignoring would be worse than undermining
          the breakeven hook — investors trust us more when we tell them what's uncertain. */}
      {warnings.length > 0 && (
        <div className="mb-4 space-y-2">
          {warnings.map((w) => (
            <div
              key={w.code}
              className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3"
            >
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs leading-relaxed text-foreground">{w.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Breakeven hero — the hook */}
      <div
        className={cn(
          'rounded-2xl border-2 p-6 sm:p-8 text-center',
          'animate-in fade-in slide-in-from-bottom-4 duration-500',
          listingAbove
            ? 'border-red-500/40 bg-red-500/5'
            : 'border-emerald-500/40 bg-emerald-500/5'
        )}
      >
        <div className="mb-2 flex items-center justify-center gap-2 text-muted-foreground">
          <TargetIcon className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium uppercase tracking-wider">
            Your walk-away number
          </span>
        </div>
        <p className="font-[family-name:var(--font-playfair)] text-3xl font-bold text-foreground sm:text-4xl">
          {listingAbove ? (
            <>
              {valueNoun} is{' '}
              <span className="text-red-600 dark:text-red-400">
                {fmt(-teaser.listingVsBreakeven)} above breakeven
              </span>
            </>
          ) : (
            <>
              {valueNoun} is{' '}
              <span className="text-emerald-600 dark:text-emerald-400">
                {fmt(teaser.listingVsBreakeven)} below breakeven
              </span>
            </>
          )}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {valueNoun} {fmt(teaser.estimatedValue)}
          {teaser.valueRangeLow && teaser.valueRangeHigh && (
            <span className="text-muted-foreground/70">
              {' '}({fmt(teaser.valueRangeLow)}–{fmt(teaser.valueRangeHigh)})
            </span>
          )}
          {' · '}Breakeven {fmt(teaser.breakevenPrice)} · Rate{' '}
          {(teaser.currentRate * 100).toFixed(2)}%
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground/70">
          Source: {valueSourceLabel(teaser.valueSource)}
        </p>
      </div>

      {/* Sub-metrics */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SubStat
          icon={HomeIcon}
          label="Est. Value"
          value={fmt(teaser.estimatedValue)}
          sub={`${property.bedrooms}bd / ${property.bathrooms}ba${teaser.sqft ? ` / ${teaser.sqft.toLocaleString()} sqft` : ''}`}
        />
        <SubStat
          icon={TrendingUpIcon}
          label="Est. Rent"
          value={`${fmt(teaser.estimatedRent)}/mo`}
          sub={
            teaser.rentMultiplied && teaser.perBedroomRent && teaser.rentMultipliedBy
              ? `${fmt(teaser.perBedroomRent)}/bed × ${teaser.rentMultipliedBy} beds (per-bed → total)`
              : teaser.yearBuilt
                ? `Built ${teaser.yearBuilt}`
                : `${property.city}, ${property.state}`
          }
        />
        <SubStat
          icon={TargetIcon}
          label="Breakeven"
          value={fmt(teaser.breakevenPrice)}
          sub="Cash-flows at ~$0/mo"
        />
        <SubStat
          icon={PercentIcon}
          label="Investor Rate"
          value={`${(teaser.currentRate * 100).toFixed(2)}%`}
          sub="PMMS + DSCR premium"
        />
      </div>
    </div>
  )
}

function SubStat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}
