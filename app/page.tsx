import type { Metadata } from 'next'
import LandingContent from '@/components/LandingContent'
import { FAQ } from '@/lib/faq'
import { BASE_URL, absoluteUrl } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Rental Property Calculator & Real Estate Deal Analyzer',
  description:
    'Analyze any US rental property in seconds. Get breakeven offer price, DSCR, 5-year IRR, cash-to-close, and AI-powered deal diagnosis. Reports from $24.99.',
  alternates: { canonical: '/' },
  openGraph: {
    siteName: 'DealDoctor',
    title: 'Rental Property Calculator & Real Estate Deal Analyzer',
    description:
      'Analyze any US rental property in seconds with breakeven offer price, DSCR, 5-year IRR, cash-to-close, and AI-powered deal diagnostics.',
    url: absoluteUrl('/'),
    type: 'website',
    images: [
      {
        url: absoluteUrl('/opengraph-image'),
        width: 1200,
        height: 630,
        alt: 'DealDoctor - Rental Property Calculator & Real Estate Deal Analyzer',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Rental Property Calculator & Real Estate Deal Analyzer',
    description:
      'Analyze any US rental property in seconds with breakeven offer price, DSCR, 5-year IRR, cash-to-close, and AI-powered deal diagnosis.',
    images: [absoluteUrl('/twitter-image')],
  },
}

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
}

const productJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'DealDoctor Investment Report',
  description:
    'On-demand real estate investment analysis for US rental properties: breakeven price, DSCR, 5-year IRR, stress tests, comps, and AI-powered deal diagnosis.',
  brand: { '@type': 'Brand', name: 'DealDoctor' },
  url: BASE_URL,
  image: absoluteUrl('/opengraph-image'),
  offers: [
    { '@type': 'Offer', name: 'Single Report', price: '24.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: absoluteUrl('/pricing') },
    { '@type': 'Offer', name: '5-Pack Bundle', price: '69.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: absoluteUrl('/pricing') },
    { '@type': 'Offer', name: 'Pro Unlimited', price: '119.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: absoluteUrl('/pricing') },
  ],
}

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <LandingContent />
    </>
  )
}
