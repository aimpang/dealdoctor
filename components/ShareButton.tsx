'use client'

import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Share2Icon, LinkIcon, MailIcon, CheckIcon, EyeOffIcon } from 'lucide-react'

interface Props {
  uuid: string
  address: string
}

/**
 * Lightweight share menu — appears in the report's top utility bar.
 *
 * Three one-click actions:
 *   1. Copy full report link
 *   2. Copy lender-ready link (adds ?view=lender)
 *   3. Open an email draft with subject + body prefilled
 *
 * No fancy UI dependencies — just a positioned dropdown with outside-click
 * dismissal and a "Copied!" confirmation state.
 */
export function ShareButton({ uuid, address }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<'full' | 'lender' | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Outside-click dismiss
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Auto-dismiss "Copied!" after 2s
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const fullUrl = typeof window !== 'undefined' ? window.location.origin + `/report/${uuid}` : ''
  const lenderUrl = fullUrl ? `${fullUrl}?view=lender` : ''

  const copy = async (which: 'full' | 'lender') => {
    const url = which === 'lender' ? lenderUrl : fullUrl
    try {
      await navigator.clipboard.writeText(url)
      setCopied(which)
    } catch {
      // Clipboard may fail in insecure contexts — fallback to selecting text
      window.prompt('Copy this link:', url)
    }
  }

  const emailSubject = `Deal analysis — ${address}`
  const emailBody =
    `Hey,\n\n` +
    `Sharing a DealDoctor analysis for ${address}. The full report covers ` +
    `breakeven, DSCR, 5-year wealth projection, financing alternatives, and ` +
    `climate risk — plus an AI diagnosis with negotiation scripts.\n\n` +
    `Full analysis:\n${fullUrl}\n\n` +
    `Lender-ready view (hides rehab/STR/appreciation assumptions):\n${lenderUrl}\n\n` +
    `Let me know your thoughts.`

  const mailto = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
          open
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Share2Icon className="h-3.5 w-3.5" />
        Share
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-md border bg-card shadow-lg',
            'animate-in fade-in zoom-in-95 duration-150'
          )}
        >
          <button
            role="menuitem"
            onClick={() => copy('full')}
            className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-xs hover:bg-muted"
          >
            {copied === 'full' ? (
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div>
              <p className="font-medium text-foreground">
                {copied === 'full' ? 'Copied!' : 'Copy full report link'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                For a partner or co-investor — full analysis
              </p>
            </div>
          </button>

          <button
            role="menuitem"
            onClick={() => copy('lender')}
            className="flex w-full items-start gap-2 border-t px-3 py-2.5 text-left text-xs hover:bg-muted"
          >
            {copied === 'lender' ? (
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <EyeOffIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div>
              <p className="font-medium text-foreground">
                {copied === 'lender' ? 'Copied!' : 'Copy lender-ready link'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Same report, hides STR/rehab/appreciation assumptions
              </p>
            </div>
          </button>

          <a
            role="menuitem"
            href={mailto}
            className="flex w-full items-start gap-2 border-t px-3 py-2.5 text-left text-xs hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <MailIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium text-foreground">Email with draft</p>
              <p className="text-[10px] text-muted-foreground">
                Opens your mail client with subject + body prefilled
              </p>
            </div>
          </a>
        </div>
      )}
    </div>
  )
}
