'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ChevronDownIcon,
  StethoscopeIcon,
  WrenchIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  HandshakeIcon,
  EyeIcon,
} from 'lucide-react'

interface DealDoctorProps {
  dealDoctor: {
    diagnosis: string
    fixes: {
      title: string
      subtitle: string
      difficulty: 'easy' | 'medium' | 'hard'
      resultValue: string
      resultLabel: string
      detailRows: { label: string; value: string }[]
    }[]
    bottomLine: string
    tonePositive: boolean
    pros?: string[]
    cons?: string[]
    negotiationLevers?: { lever: string; script: string }[]
    inspectionRedFlags?: { area: string; why: string }[]
  }
  verdict: 'DEAL' | 'MARGINAL' | 'PASS'
}

const difficultyConfig = {
  easy: { label: 'Easy', bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
  medium: { label: 'Medium', bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
  hard: { label: 'Hard', bg: 'bg-red-500/10', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500' },
}

export function DealDoctorSection({ dealDoctor, verdict }: DealDoctorProps) {
  const [expandedFix, setExpandedFix] = useState<number | null>(0)

  const borderColor =
    verdict === 'DEAL'
      ? 'border-l-emerald-500'
      : verdict === 'MARGINAL'
        ? 'border-l-amber-500'
        : 'border-l-red-500'

  const hasPros = (dealDoctor.pros?.length ?? 0) > 0
  const hasCons = (dealDoctor.cons?.length ?? 0) > 0
  const hasNegotiation = (dealDoctor.negotiationLevers?.length ?? 0) > 0
  const hasInspection = (dealDoctor.inspectionRedFlags?.length ?? 0) > 0

  return (
    <div className="w-full overflow-hidden rounded-lg border bg-card">
      {/* Header */}
      <div className="flex items-center gap-3 border-b bg-foreground/[0.02] px-5 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
          <StethoscopeIcon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="font-[family-name:var(--font-playfair)] text-base font-bold text-foreground">
            Deal Doctor
          </h3>
          <p className="text-[11px] text-muted-foreground">AI-powered investment diagnosis</p>
        </div>
      </div>

      {/* Diagnosis */}
      <div className={cn('border-l-4 px-5 py-4', borderColor)}>
        <p className="text-sm leading-relaxed text-foreground">{dealDoctor.diagnosis}</p>
      </div>

      {/* Pros / Cons — two-column compact lists */}
      {(hasPros || hasCons) && (
        <div className="grid grid-cols-1 divide-y border-t sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          {hasPros && (
            <div className="px-5 py-4">
              <div className="mb-2 flex items-center gap-1.5">
                <ThumbsUpIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Pros
                </p>
              </div>
              <ul className="space-y-1 text-[13px] leading-relaxed text-foreground">
                {dealDoctor.pros!.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasCons && (
            <div className="px-5 py-4">
              <div className="mb-2 flex items-center gap-1.5">
                <ThumbsDownIcon className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">
                  Cons
                </p>
              </div>
              <ul className="space-y-1 text-[13px] leading-relaxed text-foreground">
                {dealDoctor.cons!.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-500" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Fixes — compact expandable */}
      <div className="divide-y border-t">
        {dealDoctor.fixes.map((fix, i) => {
          const isExpanded = expandedFix === i
          const diff = difficultyConfig[fix.difficulty] || difficultyConfig.medium

          return (
            <div key={i}>
              <button
                onClick={() => setExpandedFix(isExpanded ? null : i)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-foreground/[0.02]"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {fix.title}
                    </span>
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                        diff.bg,
                        diff.text
                      )}
                    >
                      <span className={cn('h-1 w-1 rounded-full', diff.dot)} />
                      {diff.label}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{fix.subtitle}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold text-primary tabular-nums">
                    {fix.resultValue}
                  </p>
                  <p className="text-[9px] text-muted-foreground">{fix.resultLabel}</p>
                </div>
                <ChevronDownIcon
                  className={cn(
                    'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                    isExpanded && 'rotate-180'
                  )}
                />
              </button>

              {fix.detailRows.length > 0 && (
                <div
                  className={cn(
                    'bg-muted/20 px-5 pb-3',
                    // Expanded on screen, OR always on print so the PDF contains
                    // all three fixes' details (not just the one the user clicked).
                    isExpanded ? 'block' : 'hidden print:block'
                  )}
                >
                  <div className="ml-10 overflow-hidden rounded-md border bg-card">
                    <table className="w-full text-xs tabular-nums">
                      <tbody>
                        {fix.detailRows.map((row, j) => (
                          <tr key={j} className={j % 2 === 0 ? '' : 'bg-muted/30'}>
                            <td className="px-3 py-1.5 text-muted-foreground">{row.label}</td>
                            <td className="px-3 py-1.5 text-right font-medium text-foreground">
                              {row.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Negotiation Levers */}
      {hasNegotiation && (
        <div className="border-t px-5 py-4">
          <div className="mb-3 flex items-center gap-1.5">
            <HandshakeIcon className="h-3.5 w-3.5 text-primary" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              What to negotiate with the seller
            </p>
          </div>
          <ol className="space-y-2.5">
            {dealDoctor.negotiationLevers!.map((n, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{n.lever}</p>
                  <p className="mt-0.5 text-[12px] italic leading-snug text-muted-foreground">
                    &ldquo;{n.script}&rdquo;
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Inspection Red Flags */}
      {hasInspection && (
        <div className="border-t bg-amber-500/[0.05] px-5 py-4">
          <div className="mb-3 flex items-center gap-1.5">
            <EyeIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Tell your inspector to look closely at
            </p>
          </div>
          <ul className="space-y-2">
            {dealDoctor.inspectionRedFlags!.map((r, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 text-sm font-bold text-amber-700 dark:text-amber-400">
                  {r.area}
                </span>
                <span className="text-[12px] leading-snug text-foreground">— {r.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bottom Line */}
      {dealDoctor.bottomLine && (
        <div className="border-t bg-primary/[0.04] px-5 py-3">
          <div className="flex items-start gap-2">
            <WrenchIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm font-medium text-foreground">{dealDoctor.bottomLine}</p>
          </div>
        </div>
      )}
    </div>
  )
}
