import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'
import { absoluteUrl, SUPPORT_EMAIL, SUPPORT_MAILTO_URL } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'The terms that cover your purchase and use of a DealDoctor investment report.',
  alternates: { canonical: '/terms' },
  openGraph: {
    type: 'website',
    siteName: 'DealDoctor',
    url: absoluteUrl('/terms'),
    title: 'DealDoctor Terms of Service',
    description:
      'The terms that cover your purchase and use of a DealDoctor investment report.',
    images: [
      {
        url: absoluteUrl('/opengraph-image'),
        width: 1200,
        height: 630,
        alt: 'DealDoctor terms of service',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DealDoctor Terms of Service',
    description:
      'The terms that cover your purchase and use of a DealDoctor investment report.',
    images: [absoluteUrl('/twitter-image')],
  },
}

export default function TermsPage() {
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
        § Terms
      </div>
      <h1 className="mt-4 font-[family-name:var(--font-fraunces)] text-[52px] font-medium leading-[0.98] tracking-tight text-foreground [font-variation-settings:'opsz'_144,'SOFT'_50] sm:text-[68px]">
        The fine print.
      </h1>

      <div className="mt-8 space-y-5 font-[family-name:var(--font-instrument)] text-[15px] leading-[1.65] text-foreground/75">
        <p>
          DealDoctor sells property investment reports for <strong className="font-semibold text-foreground">$24.99</strong> (single),
          <strong className="font-semibold text-foreground"> $69.99</strong> (five-pack, $14 per report), and
          <strong className="font-semibold text-foreground"> $119.99/month</strong> (unlimited). Pricing is in USD and is charged
          at checkout through LemonSqueezy, our merchant of record.
        </p>
        <p>
          Reports are <strong className="font-semibold text-foreground">informational only</strong>. They are a quantitative aid assembled
          from third-party data providers (Rentcast, FEMA, Mapbox, Freddie Mac PMMS) and a
          documented deterministic methodology plus AI-generated commentary. They are
          <strong className="font-semibold text-foreground"> not investment, legal, tax, or financial advice</strong>, not a substitute
          for professional counsel, and not a guarantee of future returns or insurability. Always
          verify critical figures against your own due diligence before making a real offer.
        </p>
        <p>
          <strong className="font-semibold text-foreground">Refunds:</strong> we offer a 7-day refund window on any single or 5-pack
          purchase if the report failed to generate or if the underlying property data was
          materially wrong. Email{' '}
          <a
            href={SUPPORT_MAILTO_URL}
            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            {SUPPORT_EMAIL}
          </a>
          . Unlimited subscriptions may be cancelled at any time through LemonSqueezy; cancellation
          ends future renewals but does not pro-rate the current billing period.
        </p>
        <p>
          <strong className="font-semibold text-foreground">Acceptable use:</strong> reports are for your own research or the research
          of clients you are advising. Automated scraping, bulk redistribution, or reselling the
          output are not permitted. We may rate-limit or revoke access to accounts abusing the
          service.
        </p>
        <p>
          These terms are governed by the laws of the jurisdiction in which DealDoctor is
          operated. Continuing to use the service after a change to these terms constitutes
          acceptance of the updated version.
        </p>
      </div>
    </div>
  )
}
