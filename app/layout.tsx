import type { Metadata } from 'next'
import { Fraunces, Instrument_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'
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

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'DealDoctor — Real Estate Deal Analyzer for Investors',
    template: '%s | DealDoctor',
  },
  description:
    'Paste a US property address. Get the exact breakeven offer price, 5-year wealth projection, DSCR stress test, and AI-powered investment property diagnosis. First look free.',
  keywords: [
    'real estate investment analysis',
    'rental property calculator',
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
    siteName: 'DealDoctor',
    url: absoluteUrl('/'),
    title: 'DealDoctor — Real Estate Deal Analyzer for Investors',
    description:
      'Exact breakeven price, 5-year wealth projection, DSCR stress test, and AI-powered deal diagnosis for any US rental property. First look free.',
    images: [{ url: absoluteUrl('/opengraph-image'), width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DealDoctor — Real Estate Deal Analyzer',
    description:
      'Exact breakeven price, 5-year IRR, DSCR stress test, and AI-powered negotiation scripts. First look free.',
    images: [absoluteUrl('/twitter-image')],
  },
  icons: {
    icon: '/logo.svg',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
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
  potentialAction: {
    '@type': 'SearchAction',
    target: `${BASE_URL}/?address={search_term_string}`,
    'query-input': 'required name=search_term_string',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
