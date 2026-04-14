'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/Logo'
import { ArrowLeftIcon, MailIcon, CheckCircle2Icon, LoaderIcon, KeyIcon } from 'lucide-react'

export default function RetrievePage() {
  const [mode, setMode] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'restored' | 'error'>('idle')
  const [error, setError] = useState('')
  const [restored, setRestored] = useState<null | { email: string; entitlementType: string | null; reportsRemaining: number }>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.includes('@')) {
      setError('Enter a valid email address')
      return
    }
    setStatus('sending')
    setError('')
    try {
      const res = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Something went wrong')
        setStatus('error')
        return
      }
      setStatus('sent')
    } catch {
      setError('Network error. Please try again.')
      setStatus('error')
    }
  }

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = recoveryCode.trim().toUpperCase()
    if (code.length < 6) {
      setError('Enter the recovery code from your purchase receipt')
      return
    }
    setStatus('sending')
    setError('')
    try {
      const res = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Recovery failed')
        setStatus('error')
        return
      }
      setRestored({
        email: data.email,
        entitlementType: data.entitlementType,
        reportsRemaining: data.reportsRemaining,
      })
      setStatus('restored')
    } catch {
      setError('Network error. Please try again.')
      setStatus('error')
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-14 sm:py-20">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to DealDoctor
      </Link>

      <div className="mt-8 flex justify-center">
        <Logo variant="mark" size="lg" />
      </div>

      <h1 className="mt-6 text-center font-[family-name:var(--font-playfair)] text-3xl font-bold text-foreground sm:text-4xl">
        Retrieve your access
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Lost your report link, or on a new device? Enter the email you used to
        buy. We&apos;ll send a restore link.
      </p>

      <div className="mt-6 flex justify-center gap-1 rounded-md border bg-muted/30 p-1 text-xs">
        <button
          type="button"
          onClick={() => { setMode('email'); setStatus('idle'); setError('') }}
          className={cn(
            'rounded px-3 py-1.5 font-medium transition-colors',
            mode === 'email' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Magic link by email
        </button>
        <button
          type="button"
          onClick={() => { setMode('code'); setStatus('idle'); setError('') }}
          className={cn(
            'rounded px-3 py-1.5 font-medium transition-colors',
            mode === 'code' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Recovery code
        </button>
      </div>

      {status === 'restored' && restored ? (
        <div className="mt-6 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-5 text-center">
          <CheckCircle2Icon className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          <p className="mt-3 text-sm font-semibold text-foreground">Access restored</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{restored.email}</span>.
            {restored.entitlementType === '5pack' && ` ${restored.reportsRemaining} report${restored.reportsRemaining === 1 ? '' : 's'} remaining.`}
            {restored.entitlementType === 'unlimited' && ' Unlimited access active.'}
          </p>
          <Link href="/" className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">
            Analyze a property →
          </Link>
        </div>
      ) : status === 'sent' ? (
        <div className="mt-8 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-5 text-center">
          <CheckCircle2Icon className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          <p className="mt-3 text-sm font-semibold text-foreground">Check your email</p>
          <p className="mt-1 text-xs text-muted-foreground">
            If <span className="font-medium text-foreground">{email}</span> is in our system,
            we just sent a restore link. It will set up your 5-pack or Unlimited session
            on this device.
          </p>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Didn&apos;t arrive in a minute? Check spam.
          </p>
        </div>
      ) : mode === 'email' ? (
        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Email address
            </span>
            <div className="mt-1 flex items-center rounded-md border border-border/70 bg-card focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
              <MailIcon className="ml-3 h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-transparent px-3 py-2.5 text-sm outline-none"
                autoComplete="email"
                required
              />
            </div>
          </label>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={status === 'sending'}
            className={cn(
              'inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors',
              'hover:bg-primary/90 disabled:opacity-60'
            )}
          >
            {status === 'sending' ? (
              <>
                <LoaderIcon className="h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              'Email me a restore link'
            )}
          </button>
        </form>
      ) : (
        <form onSubmit={handleCodeSubmit} className="mt-6 space-y-3">
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Recovery code
            </span>
            <div className="mt-1 flex items-center rounded-md border border-border/70 bg-card focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
              <KeyIcon className="ml-3 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                placeholder="DD-XXXX-XXXX"
                className="w-full bg-transparent px-3 py-2.5 font-mono text-sm uppercase tracking-wider outline-none"
                autoComplete="off"
                autoCapitalize="characters"
                required
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              From your purchase receipt. Format: DD-XXXX-XXXX.
            </p>
          </label>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={status === 'sending'}
            className={cn(
              'inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors',
              'hover:bg-primary/90 disabled:opacity-60'
            )}
          >
            {status === 'sending' ? (
              <>
                <LoaderIcon className="h-4 w-4 animate-spin" />
                Checking…
              </>
            ) : (
              'Restore access'
            )}
          </button>
        </form>
      )}

      <p className="mt-8 text-center text-[11px] text-muted-foreground">
        Never purchased? <Link href="/" className="underline hover:text-foreground">Analyze a property</Link> and unlock your first report.
      </p>
    </div>
  )
}
