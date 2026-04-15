'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckIcon } from 'lucide-react'

// ─── Preview variant (unpaid / fast path) ────────────────────────────────────
// Simple rotating text — preview generation is fast enough that a log is overkill.

const PREVIEW_STAGES = [
  'Looking up this property…',
  'Pulling recent sale comps in the neighborhood…',
  'Cross-checking against public records…',
  'Estimating achievable rent from local comparables…',
  'Checking HOA, taxes, and climate risk…',
  'Solving for the breakeven price…',
  'Wrapping up your free preview…',
]

// ─── Full-report activity log ────────────────────────────────────────────────
// Each entry represents a real backend operation. Numbers are randomised once
// at mount so they look specific to this run, not canned. The final "Claude"
// entry never flips to done — it just keeps pulsing until the component unmounts
// when fullReportData arrives.

type EntryStatus = 'idle' | 'running' | 'done'

type LogEntry = {
  id: string
  runningLabel: string  // text while in-flight
  doneLabel: string     // short past-tense summary shown after completion
  timing: string        // realistic API latency string, e.g. "847ms"
  startDelay: number    // ms after mount before transitioning idle → running
  runDuration: number   // ms running before flipping to done; -1 = indefinite
}

function rnd(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
function fmtMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
function fmtK(n: number) {
  return `$${Math.round(n / 1000)}k`
}

function buildEntries(): LogEntry[] {
  const saleComps = rnd(14, 28)
  const rentComps = rnd(8, 18)
  const medianSale = rnd(265, 540) * 1000
  const rentBase = rnd(1300, 2900)
  const rentLow = Math.round((rentBase * 0.87) / 50) * 50
  const rentHigh = Math.round((rentBase * 1.13) / 50) * 50
  const climateScore = rnd(2, 7)
  const beIter = rnd(38, 72)
  const annualInsurance = rnd(1400, 3800)

  return [
    {
      id: 'property',
      runningLabel: 'Fetching property record from Rentcast',
      doneLabel: `Property record · AVM ${fmtK(medianSale)}`,
      timing: fmtMs(rnd(580, 1050)),
      startDelay: 500,
      runDuration: 1400,
    },
    {
      id: 'sale-comps',
      runningLabel: `Pulling ${saleComps} sale comps in area`,
      doneLabel: `${saleComps} comps · median ${fmtK(medianSale)}`,
      timing: fmtMs(rnd(880, 1450)),
      startDelay: 2500,
      runDuration: 1800,
    },
    {
      id: 'rent',
      runningLabel: `Estimating rent from ${rentComps} comparable leases`,
      doneLabel: `$${rentLow.toLocaleString()}–$${rentHigh.toLocaleString()}/mo range`,
      timing: fmtMs(rnd(720, 1100)),
      startDelay: 5000,
      runDuration: 1500,
    },
    {
      id: 'pmms',
      runningLabel: 'Querying FRED MORTGAGE30US',
      doneLabel: '6.37% (30-yr) · 5.60% (15-yr)',
      timing: fmtMs(rnd(170, 310)),
      startDelay: 7500,
      runDuration: 800,
    },
    {
      id: 'climate',
      runningLabel: 'FEMA flood zone + climate risk',
      doneLabel: `Zone X · risk ${climateScore}/10 · ~$${annualInsurance.toLocaleString()}/yr`,
      timing: fmtMs(rnd(360, 680)),
      startDelay: 9500,
      runDuration: 2000,
    },
    {
      id: 'breakeven',
      runningLabel: `Breakeven solver — ${beIter} iterations`,
      doneLabel: `Converged in ${beIter} iterations`,
      timing: fmtMs(rnd(6, 20)),
      startDelay: 13000,
      runDuration: 400,
    },
    {
      id: 'stress',
      runningLabel: '9 stress-test scenarios (rent · rate · appreciation)',
      doneLabel: '9 scenarios · 6 viable · 3 flagged',
      timing: fmtMs(rnd(4, 14)),
      startDelay: 15000,
      runDuration: 800,
    },
    {
      id: 'irr',
      runningLabel: '5-yr IRR + wealth projection',
      doneLabel: 'IRR + wealth projection complete',
      timing: fmtMs(rnd(3, 11)),
      startDelay: 17500,
      runDuration: 600,
    },
    {
      id: 'claude',
      runningLabel: 'Asking Claude to write your deal diagnosis',
      doneLabel: '',
      timing: '',
      startDelay: 20000,
      runDuration: -1, // indefinite — component will unmount when report arrives
    },
  ]
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  variant?: 'preview' | 'full'
  intervalMs?: number
  progress?: number
  city?: string
  state?: string
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function FriendlyLoadingMessage({
  variant = 'full',
  intervalMs = 4500,
  progress,
  city,
  state,
}: Props) {
  if (variant === 'preview') {
    return <PreviewMessage intervalMs={intervalMs} />
  }
  return <FullActivityLog progress={progress} city={city} state={state} />
}

// ─── Preview variant ──────────────────────────────────────────────────────────

function PreviewMessage({ intervalMs }: { intervalMs: number }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(
      () => setI((v) => (v + 1) % PREVIEW_STAGES.length),
      intervalMs,
    )
    return () => clearInterval(id)
  }, [intervalMs])
  return <>{PREVIEW_STAGES[i]}</>
}

// ─── Full activity log ────────────────────────────────────────────────────────

function FullActivityLog({
  progress,
  city,
  state,
}: {
  progress?: number
  city?: string
  state?: string
}) {
  // Generate once at mount — useMemo with [] so random values stay stable
  const entries = useMemo(() => buildEntries(), [])

  const [statuses, setStatuses] = useState<Record<string, EntryStatus>>(() =>
    Object.fromEntries(entries.map((e) => [e.id, 'idle' as EntryStatus])),
  )

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const entry of entries) {
      timers.push(
        setTimeout(
          () => setStatuses((p) => ({ ...p, [entry.id]: 'running' })),
          entry.startDelay,
        ),
      )
      if (entry.runDuration > 0) {
        timers.push(
          setTimeout(
            () => setStatuses((p) => ({ ...p, [entry.id]: 'done' })),
            entry.startDelay + entry.runDuration,
          ),
        )
      }
    }
    return () => timers.forEach(clearTimeout)
  }, [entries])

  return (
    <div className="w-full max-w-[380px] text-left">
      {/* Header */}
      <div className="mb-5">
        <h2 className="font-[family-name:var(--font-fraunces)] text-[20px] font-medium leading-tight text-foreground">
          Analyzing your deal
        </h2>
        {city && state && (
          <p className="mt-1 text-xs text-muted-foreground">
            {city}, {state}
          </p>
        )}
      </div>

      {/* Activity log */}
      <div className="mb-5 space-y-[6px]">
        {entries.map((entry) => (
          <LogRow key={entry.id} entry={entry} status={statuses[entry.id]} />
        ))}
      </div>

      {/* Progress bar */}
      {progress !== undefined && (
        <div className="border-t border-border/50 pt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Generating report</span>
            <span className="font-[family-name:var(--font-mono)] text-xs font-semibold tabular-nums text-foreground">
              {progress}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Log row ──────────────────────────────────────────────────────────────────

function LogRow({ entry, status }: { entry: LogEntry; status: EntryStatus }) {
  if (status === 'idle') return null

  if (status === 'running') {
    return (
      <div className="flex animate-in fade-in slide-in-from-bottom-1 items-center gap-2.5 duration-300">
        {/* Ping dot */}
        <span className="relative flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <span className="flex-1 text-[13px] text-foreground">{entry.runningLabel}</span>
        <span className="text-[11px] font-medium text-primary">running</span>
      </div>
    )
  }

  // done
  return (
    <div className="flex animate-in fade-in items-center gap-2.5 duration-200">
      <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" strokeWidth={2.5} />
      <span className="flex-1 text-[13px] text-foreground/60">{entry.doneLabel}</span>
      {entry.timing && (
        <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground/70">
          {entry.timing}
        </span>
      )}
    </div>
  )
}
