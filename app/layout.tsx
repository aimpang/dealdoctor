import type { Metadata } from 'next'
import { Fraunces, Instrument_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { BASE_URL, absoluteUrl } from '@/lib/seo'

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz', 'SOFT'],
})

const instrument = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

const fontAliases = `
  :root {
    --font-playfair: var(--font-fraunces);
    --font-inter: var(--font-instrument);
  }
`

const googleSiteVerification = process.env.GOOGLE_SITE_VERIFICATION
const bingSiteVerification = process.env.BING_SITE_VERIFICATION

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  applicationName: 'DealDoctor',
  title: {
    default: 'DealDoctor - Rental Property Calculator for Real Estate Investors',
    template: '%s | DealDoctor',
  },
  description:
    'Analyze any US rental property with exact breakeven offer price, DSCR, 5-year IRR, cash-to-close, and AI-powered deal diagnostics.',
  authors: [{ name: 'DealDoctor', url: BASE_URL }],
  creator: 'DealDoctor',
  publisher: 'DealDoctor',
  category: 'Finance',
  keywords: [
    'real estate investment analysis',
    'real estate investment calculator',
    'rental property calculator',
    'rental property analysis',
    'investment property calculator',
    'breakeven price calculator',
    'DSCR calculator',
    'investment property report',
    'deal analysis tool',
    'real estate underwriting',
    'cap rate calculator',
    'IRR projection',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'DealDoctor',
    url: absoluteUrl('/'),
    title: 'DealDoctor - Rental Property Calculator for Real Estate Investors',
    description:
      'Analyze any US rental property with exact breakeven offer price, DSCR, 5-year IRR, cash-to-close, and AI-powered deal diagnostics.',
    images: [
      {
        url: absoluteUrl('/opengraph-image'),
        width: 1200,
        height: 630,
        alt: 'DealDoctor - Rental Property Calculator for Real Estate Investors',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DealDoctor - Rental Property Calculator',
    description:
      'Exact breakeven offer price, DSCR, 5-year IRR, cash-to-close, and AI-powered deal diagnostics for US rental properties.',
    images: [absoluteUrl('/twitter-image')],
  },
  verification: {
    google: googleSiteVerification || undefined,
    other: bingSiteVerification
      ? {
          'msvalidate.01': bingSiteVerification,
        }
      : undefined,
  },
  icons: {
    icon: '/logo.svg',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
}

const softwareAppJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'DealDoctor',
  applicationCategory: 'FinanceApplication',
  description:
    'Real-estate investment analyzer for US rental properties. Breakeven offer price, 5-year wealth projection, DSCR stress test, climate risk, and AI-powered deal diagnosis.',
  operatingSystem: 'Any (web-based)',
  url: BASE_URL,
  image: absoluteUrl('/opengraph-image'),
  offers: [
    { '@type': 'Offer', name: 'Single Report', price: '24.99', priceCurrency: 'USD' },
    { '@type': 'Offer', name: '5-Pack Bundle', price: '69.99', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Pro Unlimited', price: '119.99', priceCurrency: 'USD', billingDuration: 'P1M' },
  ],
}

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'DealDoctor',
  url: BASE_URL,
  logo: absoluteUrl('/logo.svg'),
}

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'DealDoctor',
  url: BASE_URL,
  inLanguage: 'en-US',
}

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${instrument.variable} ${mono.variable} font-sans antialiased`}
      >
        <style dangerouslySetInnerHTML={{ __html: fontAliases }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <noscript>
          <div style={{ padding: '2rem', fontFamily: 'serif', maxWidth: '640px', margin: '0 auto' }}>
            <h1>DealDoctor — Real Estate Deal Analyzer</h1>
            <p>
              Paste a US property address and get the exact breakeven offer price, 5-year wealth
              projection, DSCR stress test, and AI-powered diagnosis. Reports from $24.99.
            </p>
            <p>
              <a href="/methodology">Methodology</a> · <a href="/pricing">Pricing</a> ·{' '}
              <a href="/retrieve">Retrieve a report</a>
            </p>
            <p>JavaScript is required to run an instant analysis.</p>
          </div>
        </noscript>
        {children}
      </body>
    </html>
  )
}

export default RootLayout
