'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ThumbsUpIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  LoaderIcon,
} from 'lucide-react'

interface Props {
  uuid: string
}

type Verdict = 'ok' | 'value_off' | 'rent_off' | 'both_off'

// LocalStorage key so the widget remembers the user already gave feedback and
// doesn't spam them on every page revisit. Not bulletproof (incognito / cleared
// storage resubmits), but good enough for honest aggregate signal.
const LS_KEY = (uuid: string) => `dd_feedback_submitted_${uuid}`

export function ReportFeedback({ uuid }: Props) {
  const [submitted, setSubmitted] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(LS_KEY(uuid))) {
      setSubmitted(true)
    }
  }, [uuid])

  const submit = async (verdict: Verdict) => {
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/report/${uuid}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Could not submit')
        return
      }
      window.localStorage.setItem(LS_KEY(uuid), verdict)
      setSubmitted(true)
    } catch {
      setError('Network error')
    } finally {
      setSending(false)
    }
  }

  if (submitted) {
    return (
      <div className="no-print flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">
        <CheckCircle2Icon className="h-4 w-4 shrink-0 text-emerald-600" />
        <p className="text-foreground">
          Thanks — your feedback helps us flag inaccurate data for future buyers.
        </p>
      </div>
    )
  }

  return (
    <div className="no-print rounded-lg border border-border/70 bg-card p-5">
      <div className="mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          How did we do?
        </p>
        <h3 className="mt-0.5 text-base font-semibold text-foreground">
          Did these numbers match your research?
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Your flag stays anonymous but follows this address — future buyers of the same
          property see a warning when multiple users report the same issue.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <FeedbackButton
          onClick={() => submit('ok')}
          disabled={sending}
          tone="positive"
          label="Looks right"
          icon={ThumbsUpIcon}
        />
        <FeedbackButton
          onClick={() => submit('value_off')}
          disabled={sending}
          tone="warn"
          label="Value looks off"
          icon={AlertTriangleIcon}
        />
        <FeedbackButton
          onClick={() => submit('rent_off')}
          disabled={sending}
          tone="warn"
          label="Rent looks off"
          icon={AlertTriangleIcon}
        />
      </div>

      {error && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {sending && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderIcon className="h-3 w-3 animate-spin" />
          Sending…
        </div>
      )}
    </div>
  )
}

function FeedbackButton({
  onClick,
  disabled,
  tone,
  label,
  icon: Icon,
}: {
  onClick: () => void
  disabled: boolean
  tone: 'positive' | 'warn'
  label: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
        tone === 'positive'
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10',
        'disabled:opacity-50'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
