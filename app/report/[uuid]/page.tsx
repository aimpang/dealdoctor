'use client'

import { useEffect, useState } from 'react'

// Rotates through friendly descriptions of the stages the backend goes
// through during full-report generation. The backend is a single blocking
// call so we can't get true stage telemetry without SSE/streaming — this
// component fakes progressive disclosure by cycling every 4.5 seconds,
// which roughly matches the real pipeline (Rentcast fetches → math +
// clamps → invariant gate → Sonnet narrative → persist). If the work
// finishes before all messages have cycled, the component just unmounts
// when the outer loading flag flips.
function FriendlyLoadingMessage() {
  const STAGES = [
    'Pulling the property record from Rentcast…',
    'Tracking down recent sale comps in the neighborhood…',
    'Checking the rent comps and zip-level market trends…',
    'Pulling climate risk and FEMA flood-zone data…',
    'Applying the investor-rate premium over today\'s PMMS…',
    'Solving the breakeven price — the math that moves the deal…',
    'Running the 5-year wealth projection and IRR…',
    'Stress-testing rent, rate, and appreciation scenarios…',
    'Sanity-checking the numbers against themselves…',
    'Asking Claude to write your Deal Doctor diagnosis…',
    'Drafting negotiation scripts with the right dollar amounts…',
    'Flagging inspection items specific to this property…',
    'Wrapping up — writing the bottom line…',
  ]
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % STAGES.length), 4500)
    return () => clearInterval(id)
  }, [STAGES.length])
  return <>{STAGES[i]}</>
}
import { useParams, useSearchParams } from 'next/navigation'
import { FullReport } from '@/components/FullReport'
import { BlurredReport } from '@/components/BlurredReport'
import { PhotoAnalysis } from '@/components/PhotoAnalysis'
import { ReportFeedback } from '@/components/ReportFeedback'
import { Logo } from '@/components/Logo'
import { LoaderIcon, CheckCircle2Icon, MapPinIcon } from 'lucide-react'

export default function ReportPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const uuid = params.uuid as string
  const isSuccess = searchParams.get('success') === 'true'
  const isDebug = searchParams.get('debug') === '1'

  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let stopped = false

    const fetchReport = async () => {
      try {
        const res = await fetch(`/api/report/${uuid}${isDebug ? '?debug=1' : ''}`)
        if (!res.ok) {
          setError(res.status === 404 ? 'Report not found.' : 'Failed to load report.')
          setLoading(false)
          stopped = true
          return
        }

        const data = await res.json()
        setReport(data)

        // If paid but no full report yet, keep polling
        if (data.paid && !data.fullReportData) return

        // We have what we need
        setLoading(false)
        stopped = true
      } catch {
        setError('Network error. Please refresh.')
        setLoading(false)
        stopped = true
      }
    }

    fetchReport()
    const intervalId = setInterval(() => {
      if (stopped) return
      fetchReport()
    }, 3000)

    return () => clearInterval(intervalId)
  }, [uuid, isDebug])

  // Success flash
  const [showSuccess, setShowSuccess] = useState(isSuccess)
  useEffect(() => {
    if (isSuccess) {
      const timer = setTimeout(() => setShowSuccess(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [isSuccess])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">{error}</p>
          <a href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
            Go back to home
          </a>
        </div>
      </div>
    )
  }

  if (loading || !report) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <LoaderIcon className="h-8 w-8 animate-spin text-primary" />
          <div>
            <p className="font-semibold text-foreground">
              {report?.paid ? <FriendlyLoadingMessage /> : 'Pulling up the property record…'}
            </p>
            {report?.paid && (
              <p className="mt-1 text-sm text-muted-foreground">
                This usually takes 20-30 seconds. Please don&apos;t close this page.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  const fullData = report.fullReportData ? JSON.parse(report.fullReportData) : null

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="no-print sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <a href="/" className="inline-flex">
            <Logo variant="wordmark" size="md" />
          </a>
          <div className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-foreground">
            <MapPinIcon className="h-3 w-3 text-primary" />
            <span>Report</span>
          </div>
        </nav>
      </header>

      {/* Success banner */}
      {showSuccess && (
        <div className="no-print border-b bg-emerald-500/10">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
            <CheckCircle2Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              Payment successful! Your full report is ready.
            </p>
          </div>
        </div>
      )}

      {/* Debug-mode banner — only shown when the API flagged this response as debug */}
      {report?.debug && (
        <div className="no-print border-b border-amber-500/30 bg-amber-500/10">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
            <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">
              🔧 DEBUG MODE
            </span>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Paywall bypassed. Report is rendering as if paid. This URL only works in local dev.
            </p>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
        {report.paid && fullData ? (
          <div className="space-y-6">
            <FullReport
              data={fullData}
              uuid={uuid}
              addressFlags={report.addressFlags}
            />
            <PhotoAnalysis
              uuid={uuid}
              initialFindings={
                report.photoFindings ? JSON.parse(report.photoFindings) : null
              }
            />
            <ReportFeedback uuid={uuid} />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            <div className="text-center">
              <h2 className="font-[family-name:var(--font-playfair)] text-2xl font-bold text-foreground">
                {report.address}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {report.city}, {report.state}
              </p>
            </div>
            <BlurredReport uuid={uuid} address={report.address} />
          </div>
        )}
      </main>
    </div>
  )
}
