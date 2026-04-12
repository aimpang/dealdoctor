'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDownIcon, StethoscopeIcon, WrenchIcon } from 'lucide-react'

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

  const borderColor = verdict === 'DEAL'
    ? 'border-l-emerald-500'
    : verdict === 'MARGINAL'
    ? 'border-l-amber-500'
    : 'border-l-red-500'

  return (
    <div className="w-full rounded-xl border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 bg-foreground/[0.03] px-6 py-4 border-b">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <StethoscopeIcon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-[family-name:var(--font-playfair)] text-lg font-bold text-foreground">
            Deal Doctor
          </h3>
          <p className="text-xs text-muted-foreground">AI-powered investment diagnosis</p>
        </div>
      </div>

      {/* Diagnosis */}
      <div className={cn("border-l-4 px-6 py-5", borderColor)}>
        <p className="text-sm leading-relaxed text-foreground">
          {dealDoctor.diagnosis}
        </p>
      </div>

      {/* Fixes */}
      <div className="divide-y">
        {dealDoctor.fixes.map((fix, i) => {
          const isExpanded = expandedFix === i
          const diff = difficultyConfig[fix.difficulty] || difficultyConfig.medium

          return (
            <div key={i}>
              <button
                onClick={() => setExpandedFix(isExpanded ? null : i)}
                className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-foreground/[0.02]"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-bold text-muted-foreground">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground truncate">{fix.title}</span>
                    <span className={cn("shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", diff.bg, diff.text)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", diff.dot)} />
                      {diff.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{fix.subtitle}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold text-primary">{fix.resultValue}</p>
                  <p className="text-[10px] text-muted-foreground">{fix.resultLabel}</p>
                </div>
                <ChevronDownIcon
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    isExpanded && "rotate-180"
                  )}
                />
              </button>

              {isExpanded && fix.detailRows.length > 0 && (
                <div className="bg-muted/30 px-6 pb-4">
                  <div className="ml-12 rounded-lg border bg-card overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        {fix.detailRows.map((row, j) => (
                          <tr key={j} className={j % 2 === 0 ? '' : 'bg-muted/30'}>
                            <td className="px-4 py-2 text-muted-foreground">{row.label}</td>
                            <td className="px-4 py-2 text-right font-medium text-foreground">{row.value}</td>
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

      {/* Bottom Line */}
      {dealDoctor.bottomLine && (
        <div className="border-t bg-primary/[0.03] px-6 py-4">
          <div className="flex items-start gap-2">
            <WrenchIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm font-medium text-foreground">{dealDoctor.bottomLine}</p>
          </div>
        </div>
      )}
    </div>
  )
}
