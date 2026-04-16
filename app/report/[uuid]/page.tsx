'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { FullReport } from '@/components/FullReport'
import { BlurredReport } from '@/components/BlurredReport'
import { PhotoAnalysis } from '@/components/PhotoAnalysis'
import { ReportFeedback } from '@/components/ReportFeedback'
import { FriendlyLoadingMessage } from '@/components/FriendlyLoadingMessage'
import { Logo } from '@/components/Logo'
import { SUPPORT_EMAIL, SUPPORT_MAILTO_URL } from '@/lib/seo'
import { LoaderIcon, CheckCircle2Icon, MapPinIcon, AlertTriangleIcon } from 'lucide-react'

// After 180s (6× the "30–45 seconds" user-facing promise) we stop polling
// and surface a recovery path — infinite spinner with no escape is the worst
// experience a paid customer can have.
const POLL_TIMEOUT_MS = 180_000

export default function ReportPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const uuid = params.uuid as string
  const isSuccess = searchParams.get('success') === 'true'
  const isDebug = searchParams.get('debug') === '1'
  const isAutopaid = searchParams.get('autopaid') === '1'

  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [progress, setProgress] = useState(0)
  const pollStartRef = useRef<number>(Date.now())

  useEffect(() => {
    let stopped = false
    pollStartRef.current = Date.now()

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

        // If paid but no full report yet, keep polling — unless we've blown
        // past the generation budget. Anthropic or Rentcast hanging longer
        // than 180s means the webhook-triggered generation has almost
        // certainly failed; the buyer deserves a retry button, not an
        // infinite spinner.
        if (data.paid && !data.fullReportData) {
          if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
            setTimedOut(true)
            setLoading(false)
            stopped = true
          } else {
            // Simulated progress: fast start, asymptotes to 95% until server confirms done.
            // Target ~45s median generation time; caps at 95 so 100 is reserved for completion.
            const elapsed = (Date.now() - pollStartRef.current) / 1000
            const pct = Math.min(95, Math.round((1 - Math.exp(-elapsed / 45)) * 100))
            setProgress(pct)
          }
          return
        }

        // We have what we need
        if (data.paid) setProgress(100)
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

  const handleRetryGeneration = async () => {
    setRetrying(true)
    try {
      // Kick off a fresh Anthropic call against the already-persisted report.
      // The owner cookie set during the success redirect authorizes this.
      await fetch(`/api/report/${uuid}/retry-ai`, { method: 'POST' }).catch(() => {})
      // Restart the polling loop — reset timeout, re-enter loading state.
      setTimedOut(false)
      setLoading(true)
      setProgress(0)
      pollStartRef.current = Date.now()
      const res = await fetch(`/api/report/${uuid}${isDebug ? '?debug=1' : ''}`)
      if (res.ok) setReport(await res.json())
    } finally {
      setRetrying(false)
    }
  }

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

  if (timedOut && report?.paid) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md text-center">
          <AlertTriangleIcon className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-4 font-[family-name:var(--font-fraunces)] text-[28px] font-medium leading-tight text-foreground">
            Report generation is taking longer than expected.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-foreground/70">
            Your access is confirmed and the report is saved, but the AI narration step
            didn&apos;t finish inside our normal window. This usually clears up on a retry —
            no charge, no lost entitlement.
          </p>
          <button
            type="button"
            onClick={handleRetryGeneration}
            disabled={retrying}
            className="mt-6 inline-flex items-center gap-2 rounded-md border border-foreground/20 bg-foreground px-5 py-2.5 text-sm font-semibold text-background hover:bg-foreground/90 disabled:opacity-60"
          >
            {retrying ? (
              <>
                <LoaderIcon className="h-4 w-4 animate-spin" /> Retrying…
              </>
            ) : (
              'Retry generation'
            )}
          </button>
          <p className="mt-6 text-xs text-foreground/55">
            Still not working? Email{' '}
            <a
              href={SUPPORT_MAILTO_URL}
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              {SUPPORT_EMAIL}
            </a>{' '}
            with this URL and we&apos;ll hand-generate it.
          </p>
        </div>
      </div>
    )
  }

  if (loading || !report) {
    // Show the full activity log as soon as we know this is a paid generation:
    // - report.paid flips after the first fast poll (~200ms)
    // - isSuccess means the user just came from checkout (paid, definitely generating)
    // - isAutopaid means an active entitlement unlocked the report from preview
    // - isDebug means the GET blocks for the full generation duration (report stays
    //   null the whole time), so we need to show the log from the very first render
    const showFullLog = Boolean(report?.paid || isSuccess || isDebug || isAutopaid)
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        {showFullLog ? (
          <FriendlyLoadingMessage
            progress={progress}
            city={report?.city}
            state={report?.state}
          />
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <LoaderIcon className="h-8 w-8 animate-spin text-primary" />
            <p className="font-semibold text-foreground">
              <FriendlyLoadingMessage variant="preview" />
            </p>
          </div>
        )}
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
            <CheckCircle2Icon className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-700">
              Payment successful! Your full report is ready.
            </p>
          </div>
        </div>
      )}

      {/* Debug-mode banner — only shown when the API flagged this response as debug */}
      {report?.debug && (
        <div className="no-print border-b border-amber-500/30 bg-amber-500/10">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
            <span className="font-mono text-xs font-bold text-amber-700">
              🔧 DEBUG MODE
            </span>
            <p className="text-xs text-amber-700">
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
