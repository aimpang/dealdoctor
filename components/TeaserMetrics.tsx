'use client'

import { cn } from '@/lib/utils'
import { TrendingUpIcon, HomeIcon, BarChart3Icon } from 'lucide-react'

interface TeaserMetricsProps {
  teaser: {
    estimatedValue: number
    estimatedRent: number
    neighbourhoodScore: number
    city: string
    state: string
    bedrooms: number
    bathrooms: number
    sqft: number
    yearBuilt: number
    currentRate: number
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

export function TeaserMetrics({ teaser, property }: TeaserMetricsProps) {
  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

  const metrics = [
    {
      icon: HomeIcon,
      label: 'Estimated Value',
      value: formatCurrency(teaser.estimatedValue),
      sub: `${property.bedrooms}bd / ${property.bathrooms}ba / ${teaser.sqft?.toLocaleString() || '—'} sqft`,
      color: 'text-primary',
    },
    {
      icon: TrendingUpIcon,
      label: 'Estimated Rent',
      value: `${formatCurrency(teaser.estimatedRent)}/mo`,
      sub: `${(teaser.currentRate * 100).toFixed(2)}% 30yr fixed`,
      color: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      icon: BarChart3Icon,
      label: 'Area Score',
      value: `${teaser.neighbourhoodScore}/100`,
      sub: `${property.city}, ${property.state}`,
      color: teaser.neighbourhoodScore >= 75 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
    },
  ]

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-4 text-center">
        <p className="text-sm font-medium text-muted-foreground">Free preview for</p>
        <h3 className="font-[family-name:var(--font-playfair)] text-lg font-semibold text-foreground">
          {property.address}
        </h3>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {metrics.map((m, i) => (
          <div
            key={m.label}
            className={cn(
              "group relative overflow-hidden rounded-xl border bg-card p-5 transition-all duration-300",
              "hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5",
              "animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards",
            )}
            style={{ animationDelay: `${i * 100 + 100}ms`, animationDuration: '500ms' }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative">
              <div className="flex items-center gap-2 text-muted-foreground">
                <m.icon className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wider">{m.label}</span>
              </div>
              <p className={cn("mt-2 text-2xl font-bold tracking-tight", m.color)}>
                {m.value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{m.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
