import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'
import { absoluteUrl } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Privacy — DealDoctor',
  description:
    'What DealDoctor collects, stores, and shares when you generate a property report.',
  alternates: { canonical: '/privacy' },
  openGraph: {
    type: 'website',
    siteName: 'DealDoctor',
    url: absoluteUrl('/privacy'),
    title: 'Privacy — DealDoctor',
    description:
      'What DealDoctor collects, stores, and shares when you generate a property report.',
  },
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14 sm:py-20">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-foreground/60 hover:text-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Back
      </Link>

      <div className="mt-10 text-[10px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--primary))]">
        § Privacy
      </div>
      <h1 className="mt-4 font-[family-name:var(--font-fraunces)] text-[52px] font-medium leading-[0.98] tracking-tight text-foreground [font-variation-settings:'opsz'_144,'SOFT'_50] sm:text-[68px]">
        What we keep.
      </h1>

      <div className="mt-8 space-y-5 font-[family-name:var(--font-instrument)] text-[15px] leading-[1.65] text-foreground/75">
        <p>
          DealDoctor stores the property addresses you analyze, the report data we generate from them,
          and — once you purchase — the email address your payment was charged against. That email is
          how we restore access if you clear your browser. Your IP address is used only for short-term
          rate limiting (to keep bots from burning our data-provider budget) and is not linked to
          reports in our database.
        </p>
        <p>
          Payments are processed by <strong className="font-semibold text-foreground">LemonSqueezy</strong>,
          our merchant of record. We never see your card number. LemonSqueezy&apos;s own privacy policy
          governs their handling of payment information.
        </p>
        <p>
          We do not run third-party tracking or advertising pixels. We do not sell data. There are no
          user accounts, no newsletter auto-enrollment, and no behavioral profile attached to your
          searches. The only cookie we set is an opaque session token that unlocks reports you&apos;ve
          purchased on the device you purchased them from.
        </p>
        <p>
          Generated reports are retained indefinitely so your shareable URL keeps working — that&apos;s
          part of what you paid for. You can request deletion of your email record and any associated
          reports by writing to{' '}
          <a
            href="mailto:support@dealdoctor.com"
            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            support@dealdoctor.com
          </a>
          . Reports that have not been paid for are eligible for cleanup at our discretion after 90
          days.
        </p>
        <p className="text-[12.5px] text-foreground/55">
          Questions, deletion requests, or data-subject inquiries (GDPR / CCPA): email{' '}
          <a
            href="mailto:support@dealdoctor.com"
            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            support@dealdoctor.com
          </a>
          .
        </p>
      </div>
    </div>
  )
}
