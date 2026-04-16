'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  calculateMortgage,
  calculateDSCR,
  projectWealth,
  calculateHoldPeriodIRR,
} from '@/lib/calculations'
import { WrenchIcon, ArrowRightIcon } from 'lucide-react'

interface Props {
  offerPrice: number
  downPaymentPct: number
  annualRate: number
  loanAmount: number
  monthlyRent: number
  vacancyRate: number
  monthlyExpenses: number
  monthlyMortgagePayment: number
  annualDepreciation: number
  baselineMonthlyCashFlow: number
  baselineCashToClose: number
  baseline5yrWealth: number
  baseline5yrIRR: number
  baselineDSCR: number
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

export function RehabEstimator(p: Props) {
  const [rehabCost, setRehabCost] = useState<number>(15_000)
  const [rentBump, setRentBump] = useState<number>(150) // $/mo
  const [arvBump, setArvBump] = useState<number>(0) // $

  const newNumbers = useMemo(() => {
    const newMonthlyRent = p.monthlyRent + rentBump
    const effectiveRent = newMonthlyRent * (1 - p.vacancyRate)
    const newMonthlyCashFlow = Math.round(effectiveRent - p.monthlyMortgagePayment - p.monthlyExpenses)
    const newNOI = (effectiveRent - p.monthlyExpenses) * 12
    const newDSCR = calculateDSCR(newNOI, p.monthlyMortgagePayment * 12)

    const newPropertyValue = p.offerPrice + arvBump
    // Depreciation scales with improved basis — modest approximation
    const newAnnualDep = Math.round((newPropertyValue * 0.80) / 27.5)

    const newProjections = projectWealth({
      offerPrice: newPropertyValue,
      loanAmount: p.loanAmount,
      annualRate: p.annualRate,
      amortYears: 30,
      initialMonthlyRent: newMonthlyRent,
      vacancyRate: p.vacancyRate,
      initialMonthlyExpenses: p.monthlyExpenses,
      annualDepreciation: newAnnualDep,
      years: 5,
    })
    const new5yrWealth = newProjections[newProjections.length - 1]?.totalWealthBuilt ?? 0

    // Total cash in deal grows by rehab cost; reserves stay pegged to PITI, which
    // didn't change (rent bump doesn't change the mortgage or tax).
    const newCashToClose = p.baselineCashToClose + rehabCost
    const new5yrIRR = calculateHoldPeriodIRR(newCashToClose, newProjections)

    return {
      monthlyCashFlow: newMonthlyCashFlow,
      dscr: newDSCR,
      cashToClose: newCashToClose,
      fiveYrWealth: new5yrWealth,
      fiveYrIRR: new5yrIRR,
      monthlyRent: newMonthlyRent,
    }
  }, [rehabCost, rentBump, arvBump, p])

  return (
    <div className="no-print rounded-lg border border-border/70 bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <WrenchIcon className="h-4 w-4 text-primary" />
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
            Value-Add / Rehab Estimator
          </p>
          <p className="text-[11px] text-muted-foreground">
            See how rehab + higher rent changes the deal in real time
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NumberField
          label="Rehab budget"
          value={rehabCost}
          setValue={setRehabCost}
          min={0}
          step={500}
          prefix="$"
          hint="Upfront capital"
        />
        <NumberField
          label="Rent bump after rehab"
          value={rentBump}
          setValue={setRentBump}
          min={0}
          step={25}
          prefix="$"
          suffix="/mo"
          hint={`Post-rehab rent: ${fmt(p.monthlyRent + rentBump)}/mo`}
        />
        <NumberField
          label="ARV bump (optional)"
          value={arvBump}
          setValue={setArvBump}
          min={0}
          step={1000}
          prefix="$"
          hint="Value lift after rehab"
        />
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-xs tabular-nums sm:text-sm">
          <thead>
            <tr className="border-b border-border/60 text-muted-foreground">
              <th className="pb-2 text-left font-medium">Metric</th>
              <th className="pb-2 text-right font-medium">Current</th>
              <th className="pb-2 text-center font-medium"></th>
              <th className="pb-2 text-right font-medium">After Rehab</th>
              <th className="pb-2 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            <CompareRow
              label="Monthly cash flow"
              before={p.baselineMonthlyCashFlow}
              after={newNumbers.monthlyCashFlow}
              format={(n) => `${n >= 0 ? '+' : ''}${fmt(n)}`}
              tone="cashflow"
            />
            <CompareRow
              label="DSCR"
              before={p.baselineDSCR}
              after={newNumbers.dscr}
              format={(n) => `${n}x`}
              tone="dscr"
              precision={2}
            />
            <CompareRow
              label="Cash needed"
              before={p.baselineCashToClose}
              after={newNumbers.cashToClose}
              format={(n) => fmt(n)}
              tone="cost"
            />
            <CompareRow
              label="5yr wealth built"
              before={p.baseline5yrWealth}
              after={newNumbers.fiveYrWealth}
              format={(n) => fmt(n)}
              tone="wealth"
            />
            <CompareRow
              label="5yr IRR"
              before={p.baseline5yrIRR}
              after={newNumbers.fiveYrIRR}
              format={(n) => `${(n * 100).toFixed(1)}%`}
              tone="wealth"
              precision={4}
            />
          </tbody>
        </table>
      </div>

      <Verdict
        deltaWealth={newNumbers.fiveYrWealth - p.baseline5yrWealth}
        rehabCost={rehabCost}
      />
    </div>
  )
}

function NumberField({
  label,
  value,
  setValue,
  min,
  step,
  prefix,
  suffix,
  hint,
}: {
  label: string
  value: number
  setValue: (n: number) => void
  min?: number
  step?: number
  prefix?: string
  suffix?: string
  hint?: string
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1 flex items-center rounded-md border border-border/70 bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
        {prefix && <span className="pl-2.5 text-xs text-muted-foreground">{prefix}</span>}
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => setValue(Number(e.target.value))}
          min={min}
          step={step}
          className="w-full bg-transparent px-2 py-1.5 text-sm font-semibold tabular-nums text-foreground outline-none"
        />
        {suffix && <span className="pr-2.5 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </label>
  )
}

function CompareRow({
  label,
  before,
  after,
  format,
  tone,
  precision = 0,
}: {
  label: string
  before: number
  after: number
  format: (n: number) => string
  // "cashflow"/"wealth": positive delta is good. "cost": positive delta is bad.
  // "dscr": higher is better, above 1.25 is good.
  tone: 'cashflow' | 'wealth' | 'cost' | 'dscr'
  precision?: number
}) {
  const delta = after - before
  const isBetter =
    tone === 'cost' ? delta < 0 : delta > 0
  const color =
    Math.abs(delta) < Math.pow(10, -precision) / 2
      ? 'text-muted-foreground'
      : isBetter
        ? 'text-emerald-700'
        : 'text-red-700'
  return (
    <tr className="border-b border-border/30 last:border-b-0">
      <td className="py-2 font-medium text-foreground">{label}</td>
      <td className="py-2 text-right text-muted-foreground">{format(before)}</td>
      <td className="py-2 text-center text-muted-foreground">
        <ArrowRightIcon className="mx-auto h-3 w-3" />
      </td>
      <td className="py-2 text-right font-semibold text-foreground">{format(after)}</td>
      <td className={cn('py-2 text-right font-medium', color)}>
        {delta >= 0 ? '+' : ''}
        {format(delta)}
      </td>
    </tr>
  )
}

function Verdict({ deltaWealth, rehabCost }: { deltaWealth: number; rehabCost: number }) {
  // Rough heuristic: is the added wealth > 2× the rehab cost? 1×? less?
  const roi = rehabCost > 0 ? deltaWealth / rehabCost : 0
  let message: string
  let tone: 'good' | 'ok' | 'bad'
  if (deltaWealth <= 0) {
    tone = 'bad'
    message = `Rehab reduces total 5yr wealth. Skip the rehab or rethink the deal.`
  } else if (roi >= 2) {
    tone = 'good'
    message = `Strong value-add: each $1 of rehab returns ~$${roi.toFixed(1)} of 5yr wealth.`
  } else if (roi >= 1) {
    tone = 'ok'
    message = `Positive but modest: $1 rehab → ~$${roi.toFixed(1)} wealth. Worth doing if your time allows.`
  } else {
    tone = 'bad'
    message = `Return on rehab is under 1×. Re-check your rent bump assumption.`
  }

  return (
    <div
      className={cn(
        'mt-4 rounded-md border p-3 text-xs leading-relaxed',
        tone === 'good' && 'border-emerald-500/40 bg-emerald-500/5 text-emerald-900',
        tone === 'ok' && 'border-amber-500/40 bg-amber-500/5 text-amber-900',
        tone === 'bad' && 'border-red-500/40 bg-red-500/5 text-red-900'
      )}
    >
      {message}
    </div>
  )
}
