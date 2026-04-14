import { ImageResponse } from 'next/og'
import { BASE_URL } from '@/lib/seo'

const DISPLAY_DOMAIN = (() => {
  try {
    return new URL(BASE_URL).hostname.replace(/^www\./, '')
  } catch {
    return 'dealdoctor.com'
  }
})()

// Shared implementation for the root-level OpenGraph + Twitter share cards.
// Both `app/opengraph-image.tsx` and `app/twitter-image.tsx` render the same
// editorial masthead layout; this helper keeps the two routes in sync without
// duplication (Next.js convention routes don't resolve re-exports reliably).
//
// Editorial masthead: deep warm-black paper, serif wordmark with the signature
// pulse mark + orange apex dot, and a small-caps data-source credit row.

export const OG_SIZE = { width: 1200, height: 630 } as const

async function loadGoogleFont(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const url = new URL('https://fonts.googleapis.com/css2')
    url.searchParams.set('family', `${family}:wght@${weight}`)
    url.searchParams.set('text', text)
    const css = await fetch(url.toString()).then((r) => r.text())
    const fontUrl = css.match(/src:\s*url\(([^)]+)\)/)?.[1]
    if (!fontUrl) return null
    return await fetch(fontUrl).then((r) => r.arrayBuffer())
  } catch {
    return null
  }
}

export async function renderOgCard() {
  const playfair = await loadGoogleFont('Playfair Display', 900, 'DealDoctor')
  const fonts = playfair
    ? [{ name: 'Playfair', data: playfair, style: 'normal' as const, weight: 900 as const }]
    : []

  return new ImageResponse(
    (
      <div
        style={{
          width: OG_SIZE.width,
          height: OG_SIZE.height,
          display: 'flex',
          flexDirection: 'column',
          background: '#0a0a0b',
          color: '#f5f0e8',
          fontFamily: 'Georgia, serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '36px 64px 0',
            fontSize: 13,
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
            color: 'rgba(245,240,232,0.55)',
          }}
        >
          <span>Vol · MMXXVI</span>
          <span>Diagnostic Report № 01</span>
        </div>

        <div
          style={{
            margin: '20px 64px 0',
            height: 1,
            background: 'rgba(245,240,232,0.15)',
            display: 'flex',
          }}
        />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            justifyContent: 'center',
            padding: '0 64px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <svg
              width="180"
              height="90"
              viewBox="0 0 64 32"
              xmlns="http://www.w3.org/2000/svg"
              style={{ marginRight: 36 }}
            >
              <path
                d="M0 22 L18 22 M46 22 L64 22"
                stroke="#f5f0e8"
                strokeOpacity="0.3"
                strokeWidth="1.6"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M18 22 L22 26 L32 6 L42 26 L46 22"
                stroke="#f5f0e8"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <circle cx="32" cy="6" r="2.6" fill="#e34a1c" />
            </svg>
            <div
              style={{
                display: 'flex',
                fontSize: 148,
                fontWeight: 900,
                letterSpacing: '-0.035em',
                lineHeight: 1,
                fontFamily: playfair ? 'Playfair, Georgia, serif' : 'Georgia, serif',
              }}
            >
              <span style={{ color: '#f5f0e8' }}>Deal</span>
              <span style={{ color: '#e34a1c' }}>Doctor</span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 36,
              fontSize: 34,
              fontStyle: 'italic',
              color: 'rgba(245,240,232,0.75)',
              letterSpacing: '-0.01em',
            }}
          >
            Deal diagnostics for serious real-estate investors.
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 20,
              fontSize: 15,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: 'rgba(245,240,232,0.5)',
            }}
          >
            Breakeven · DSCR · 5-Year Wealth · Climate · AI Diagnosis
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 64px 36px',
            fontSize: 13,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: 'rgba(245,240,232,0.4)',
          }}
        >
          <span>Rentcast · FEMA · Freddie Mac · Anthropic</span>
          <span style={{ color: 'rgba(245,240,232,0.6)' }}>{DISPLAY_DOMAIN}</span>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts }
  )
}
