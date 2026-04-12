'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DollarSignIcon,
  PercentIcon,
  WrenchIcon,
  HomeIcon,
  LoaderIcon,
  TargetIcon,
  CheckCircle2Icon,
  MinusCircleIcon,
  XCircleIcon,
} from 'lucide-react'

type Strategy = 'LTR' | 'STR' | 'FLIP'

interface Teaser {
  estimatedValue: number
  estimatedRent: number
  currentRate: number
}

interface RefinePreview {
  breakevenPrice: number
  yourOffer: number
  deltaVsBreakeven: number
  monthlyPayment: number
  monthlyCashFlow: number
  dscr: number
  capRate: number
  cashOnCashReturn: number
  verdict: 'DEAL' | 'MARGINAL' | 'PASS'
  dealScore: number
}

interface Props {
  uuid: string
  teaser: Teaser
  onPreview: (p: RefinePreview) => void
}

const STRATEGIES: { id: Strategy; label: string; sub: string }[] = [
  { id: 'LTR', label: 'Long-term rental', sub: '12-month lease' },
  { id: 'STR', label: 'Short-term rental', sub: 'Airbnb / VRBO' },
  { id: 'FLIP', label: 'Fix & flip', sub: 'Sell after rehab' },
]

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

export function DealInputs({ uuid, teaser, onPreview }: Props) {
  const [offer, setOffer] = useState<number>(teaser.estimatedValue)
  const [downPct, setDownPct] = useState<number>(20)
  const [rehab, setRehab] = useState<number>(0)
  const [strategy, setStrategy] = useState<Strategy>('LTR')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<RefinePreview | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uuid,
          offerPrice: offer,
          downPaymentPct: downPct / 100,
          rehabBudget: rehab,
          strategy,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not run analysis')
        return
      }
      setPreview(data)
      onPreview(data)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const verdictConfig = {
    DEAL: { label: 'Strong Deal', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', Icon: CheckCircle2Icon },
    MARGINAL: { label: 'Marginal', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', Icon: MinusCircleIcon },
    PASS: { label: 'Pass', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', Icon: XCircleIcon },
  }

  return (
    <div className="w-full max-w-3xl rounded-2xl border bg-card p-6 sm:p-8">
      <div className="mb-5 text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
          <TargetIcon className="h-3 w-3 text-primary" />
          <span>Step 2 · Your deal</span>
        </div>
        <h3 className="font-[family-name:var(--font-playfair)] text-xl font-bold text-foreground sm:text-2xl">
          What&apos;s <span className="text-primary">your</span> offer?
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll tell you the exact price this deal breaks even — and if your offer beats it.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            label="Your offer price"
            icon={DollarSignIcon}
            value={offer}
            onChange={setOffer}
            min={30_000}
            step={1000}
            prefix="$"
            hint={`Listing: ${fmt(teaser.estimatedValue)}`}
          />
          <Field
            label="Down payment"
            icon={PercentIcon}
            value={downPct}
            onChange={setDownPct}
            min={3.5}
            max={50}
            step={0.5}
            suffix="%"
            hint="DSCR loans start at 20%"
          />
          <Field
            label="Rehab budget"
            icon={WrenchIcon}
            value={rehab}
            onChange={setRehab}
            min={0}
            step={500}
            prefix="$"
            hint="Optional — $0 if turnkey"
          />
        </div>

        <div>
          <label className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <HomeIcon className="h-3.5 w-3.5" />
            Strategy
          </label>
          <div className="grid grid-cols-3 gap-2">
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStrategy(s.id)}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left transition-all',
                  strategy === s.id
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-primary/40'
                )}
              >
                <p className="text-sm font-semibold text-foreground">{s.label}</p>
                <p className="text-[10px] text-muted-foreground">{s.sub}</p>
              </button>
            ))}
          </div>
          {strategy !== 'LTR' && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Full {strategy} analysis coming soon — we&apos;ll run LTR numbers with a {strategy} pivot fix in the report.
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button type="submit" size="lg" disabled={loading} className="w-full gap-2 font-bold">
          {loading ? (
            <>
              <LoaderIcon className="h-4 w-4 animate-spin" />
              Running numbers…
            </>
          ) : (
            <>Run my numbers</>
          )}
        </Button>
      </form>

      {preview && (
        <div className="mt-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {(() => {
            const v = verdictConfig[preview.verdict]
            const above = preview.deltaVsBreakeven < 0 // offer > breakeven = bad
            return (
              <div className={cn('rounded-xl border p-5', v.bg, v.border)}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <v.Icon className={cn('h-5 w-5', v.color)} />
                      <p className={cn('font-bold', v.color)}>{v.label}</p>
                      <span className="text-xs text-muted-foreground">· {preview.dealScore}/100</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground sm:text-3xl">
                      {above ? (
                        <>Offer <span className="text-red-600 dark:text-red-400">{fmt(-preview.deltaVsBreakeven)}</span> above breakeven</>
                      ) : (
                        <>Offer <span className="text-emerald-600 dark:text-emerald-400">{fmt(preview.deltaVsBreakeven)}</span> below breakeven</>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Your offer {fmt(preview.yourOffer)} · Breakeven price {fmt(preview.breakevenPrice)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Monthly payment" value={fmt(preview.monthlyPayment)} />
                  <Stat
                    label="Cash flow"
                    value={`${preview.monthlyCashFlow >= 0 ? '+' : ''}${fmt(preview.monthlyCashFlow)}/mo`}
                    positive={preview.monthlyCashFlow >= 0}
                  />
                  <Stat label="Cap rate" value={`${preview.capRate}%`} />
                  <Stat label="DSCR" value={`${preview.dscr}x`} positive={preview.dscr >= 1.25} />
                </div>

                <p className="mt-4 text-xs text-muted-foreground">
                  The full report shows 3 specific fixes to get this to a strong deal, refi scenarios at 5%–8%,
                  depreciation tax benefits, and comparable sales. Unlock below.
                </p>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  icon: Icon,
  value,
  onChange,
  min,
  max,
  step,
  prefix,
  suffix,
  hint,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  prefix?: string
  suffix?: string
  hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <div className="flex items-center rounded-lg border bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
        {prefix && (
          <span className="pl-3 text-sm text-muted-foreground">{prefix}</span>
        )}
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(Number(e.target.value))}
          min={min}
          max={max}
          step={step}
          className="w-full bg-transparent px-3 py-2.5 text-base font-semibold text-foreground outline-none"
        />
        {suffix && (
          <span className="pr-3 text-sm text-muted-foreground">{suffix}</span>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </label>
  )
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-lg border bg-background/50 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-lg font-bold',
          positive === true && 'text-emerald-600 dark:text-emerald-400',
          positive === false && 'text-red-600 dark:text-red-400',
          positive === undefined && 'text-foreground'
        )}
      >
        {value}
      </p>
    </div>
  )
}
