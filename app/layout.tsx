'use client'

import { Fraunces, Instrument_Sans, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import "maplibre-gl/dist/maplibre-gl.css"
import { useEffect, useState } from "react"

// Fraunces — an expressive variable serif with soft/hard + optical-size axes.
// Picked for the masthead feel (think Harper's, FT Weekend, a financial
// circular) without the overused Playfair cadence.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz", "SOFT"],
})

// Instrument Sans — a contemporary sans with just enough character to avoid
// feeling like Inter-boilerplate while staying quietly readable at body size.
const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
})

// Monospace for tabular numerals — currency, percentages, anything that
// should line up across rows.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
})

// Legacy aliases so existing components that still reference --font-playfair
// or --font-inter continue to render correctly without a repo-wide rename.
const fontAliases = `
  :root {
    --font-playfair: var(--font-fraunces);
    --font-inter: var(--font-instrument);
  }
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [darkMode, setDarkMode] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem("dealdoctor-theme")
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setDarkMode(true)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode)
    localStorage.setItem("dealdoctor-theme", darkMode ? "dark" : "light")
  }, [darkMode])

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>DealDoctor — Know if a real-estate deal is worth it before you offer</title>
        <meta
          name="description"
          content="Paste a US property address. Get the exact breakeven offer price, 5-year wealth projection + IRR, DSCR stress test, climate risk, and an AI-powered deal diagnosis with specific negotiation scripts. First look free · $24.99 single · 7-day refund."
        />
        <meta
          name="keywords"
          content="real estate investment analysis, breakeven price calculator, DSCR calculator, rental property analyzer, real estate investor tools, cash flow analysis, BRRRR calculator, cap rate calculator, IRR projection, DealDoctor"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="DealDoctor" />
        <meta
          property="og:title"
          content="DealDoctor — Know if a real-estate deal is worth it before you offer"
        />
        <meta
          property="og:description"
          content="Exact breakeven offer price, 5-year wealth projection, DSCR stress test, climate risk, and an AI-powered deal diagnosis — for any US property. First look free."
        />
        <meta property="og:image" content="/logo.svg" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="DealDoctor — Real-estate deal analyzer for investors"
        />
        <meta
          name="twitter:description"
          content="Exact breakeven price, 5-year IRR, DSCR stress test, climate risk, and AI-powered negotiation scripts. First look free."
        />

        {/* JSON-LD structured data — helps Google surface pricing tiers + product info */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'DealDoctor',
              applicationCategory: 'FinanceApplication',
              description:
                'Real-estate investment analyzer for US properties. Breakeven offer price, 5-year wealth projection, DSCR stress test, climate risk, and AI-powered deal diagnosis.',
              operatingSystem: 'Any',
              offers: [
                {
                  '@type': 'Offer',
                  name: 'Single Report',
                  price: '24.99',
                  priceCurrency: 'USD',
                },
                {
                  '@type': 'Offer',
                  name: '5-Pack Bundle',
                  price: '69.99',
                  priceCurrency: 'USD',
                },
                {
                  '@type': 'Offer',
                  name: 'Pro Unlimited',
                  price: '119.99',
                  priceCurrency: 'USD',
                  billingDuration: 'P1M',
                },
              ],
            }),
          }}
        />
      </head>
      <body
        className={`${fraunces.variable} ${instrument.variable} ${mono.variable} font-sans antialiased`}
      >
        <style dangerouslySetInnerHTML={{ __html: fontAliases }} />
        <ThemeToggle darkMode={darkMode} setDarkMode={setDarkMode} />
        {children}
      </body>
    </html>
  )
}

function ThemeToggle({ darkMode, setDarkMode }: { darkMode: boolean; setDarkMode: (v: boolean) => void }) {
  return (
    <button
      onClick={() => setDarkMode(!darkMode)}
      className="fixed top-4 right-4 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card/80 backdrop-blur-sm transition-all hover:scale-110 hover:bg-card"
      aria-label="Toggle theme"
    >
      {darkMode ? (
        <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ) : (
        <svg className="h-4 w-4 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  )
}
