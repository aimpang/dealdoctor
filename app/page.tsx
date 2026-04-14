import type { Metadata } from 'next'
import LandingContent from '@/components/LandingContent'
import { FAQ } from '@/lib/faq'
import { BASE_URL, absoluteUrl } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Real Estate Deal Analyzer — Breakeven Price in 30 Seconds',
  description:
    'Paste a US property address. Get the exact breakeven offer price, 5-year IRR, DSCR stress test, and AI-powered investment property diagnosis. Reports from $24.99.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Real Estate Deal Analyzer — DealDoctor',
    description:
      'Exact breakeven price, 5-year wealth projection, DSCR stress test, and AI-powered deal analysis for any US rental property.',
    url: absoluteUrl('/'),
    type: 'website',
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
