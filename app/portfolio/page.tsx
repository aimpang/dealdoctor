'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  listSavedDeals,
  removeDeal,
  type SavedDeal,
} from '@/lib/portfolio'
import {
  ArrowLeftIcon,
  MapPinIcon,
  Trash2Icon,
  CheckCircle2Icon,
  XCircleIcon,
  MinusCircleIcon,
} from 'lucide-react'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

const verdictConfig = {
  DEAL: { label: 'Deal', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-500/10', Icon: CheckCircle2Icon },
  MARGINAL: { label: 'Marginal', color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/10', Icon: MinusCircleIcon },
  PASS: { label: 'Pass', color: 'text-red-700 dark:text-red-400', bg: 'bg-red-500/10', Icon: XCircleIcon },
}

export default function PortfolioPage() {
  const [deals, setDeals] = useState<SavedDeal[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setDeals(listSavedDeals())
    setHydrated(true)
  }, [])

  const handleRemove = (uuid: string) => {
    setDeals(removeDeal(uuid))
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
      {/* Nav */}
      <header className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to DealDoctor
        </Link>
        <div className="mt-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
              My Portfolio
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-playfair)] text-3xl font-bold text-foreground sm:text-4xl">
              Saved Deals
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Compare and revisit the properties you&apos;ve analyzed.
            </p>
          </div>
          {hydrated && deals.length > 0 && (
            <span className="text-sm tabular-nums text-muted-foreground">
              {deals.length} {deals.length === 1 ? 'deal' : 'deals'}
            </span>
          )}
        </div>
      </header>

      {/* Body */}
      {!hydrated ? (
        <div className="h-40 animate-pulse rounded-lg border bg-card" />
      ) : deals.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Comparison row (totals) */}
          <div className="mb-5 grid grid-cols-3 gap-3 text-center">
            <SummaryTile
              label="Total 5yr Wealth"
              value={fmt(
                deals.reduce((sum, d) => sum + (d.fiveYrWealth ?? 0), 0)
              )}
            />
            <SummaryTile
              label="Best IRR"
              value={
                deals.length
                  ? `${((Math.max(...deals.map((d) => (Number.isFinite(d.fiveYrIRR) ? d.fiveYrIRR! : 0)))) * 100).toFixed(1)}%`
                  : '—'
              }
            />
            <SummaryTile
              label="Deals Worth It"
              value={`${deals.filter((d) => d.verdict === 'DEAL').length} / ${deals.length}`}
            />
          </div>

          {/* List */}
          <div className="space-y-3">
            {deals.map((d) => {
              const v = d.verdict ? verdictConfig[d.verdict] : null
              const above = (d.breakevenDelta ?? 0) < 0
              return (
                <div
                  key={d.uuid}
                  className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card p-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <Link
                        href={`/report/${d.uuid}`}
                        className="truncate text-sm font-semibold text-foreground hover:underline"
                      >
                        {d.address}
                      </Link>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {d.cityState}
                      {d.savedAt && (
                        <>
                          {' · '}
                          saved {new Date(d.savedAt).toLocaleDateString()}
                        </>
                      )}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-4 tabular-nums sm:flex sm:items-center sm:gap-6">
                    {d.breakevenDelta != null && (
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                          vs Breakeven
                        </p>
                        <p
                          className={cn(
                            'text-sm font-bold',
                            above
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          )}
                        >
                          {above ? '+' : '−'}
                          {fmt(Math.abs(d.breakevenDelta))}
                        </p>
                      </div>
                    )}
                    {d.fiveYrWealth != null && (
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                          5yr Wealth
                        </p>
                        <p className="text-sm font-bold text-foreground">{fmt(d.fiveYrWealth)}</p>
                      </div>
                    )}
                    {d.fiveYrIRR != null && Number.isFinite(d.fiveYrIRR) && (
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                          IRR
                        </p>
                        <p className="text-sm font-bold text-foreground">
                          {(d.fiveYrIRR * 100).toFixed(1)}%
                        </p>
                      </div>
                    )}
                  </div>

                  {v && (
                    <div
                      className={cn(
                        'flex shrink-0 items-center gap-1 rounded-md px-2 py-1',
                        v.bg
                      )}
                    >
                      <v.Icon className={cn('h-3.5 w-3.5', v.color)} />
                      <span className={cn('text-[11px] font-bold uppercase', v.color)}>
                        {v.label}
                      </span>
                    </div>
                  )}

                  <button
                    onClick={() => handleRemove(d.uuid)}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Remove from portfolio"
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>

          <p className="mt-6 text-[11px] text-muted-foreground">
            Saved locally in your browser. When we add accounts, we&apos;ll migrate your
            portfolio server-side.
          </p>
        </>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-card/40 p-10 text-center">
      <p className="font-[family-name:var(--font-playfair)] text-xl font-bold text-foreground">
        No saved deals yet
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        On any paid report, click <span className="font-semibold">Save to Portfolio</span> to
        revisit and compare it here.
      </p>
      <Link
        href="/"
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Analyze a property
      </Link>
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-[family-name:var(--font-playfair)] text-xl font-bold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  )
}
