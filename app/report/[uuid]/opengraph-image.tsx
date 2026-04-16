import { ImageResponse } from 'next/og'
import { prisma } from '@/lib/db'
import { DISPLAY_SITE_HOSTNAME } from '@/lib/seo'

// Dynamic OG card for a specific report. Renders at /report/[uuid]/opengraph-image
// and is auto-injected into <meta og:image> by Next.js 14's convention-based metadata.
// Shared links (Twitter, Slack, email) show this card instead of a generic site preview.

export const runtime = 'nodejs' // needs Prisma
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

const OGImage = async ({ params }: { params: { uuid: string } }) => {
  const report = await prisma.report.findUnique({ where: { id: params.uuid } })
  const isPaid = report?.paid && report?.fullReportData
  const full: any = isPaid ? JSON.parse(report!.fullReportData!) : null
  const teaser: any = report?.teaserData ? JSON.parse(report.teaserData) : null

  // Generic fallback when no report data is available
  if (!report || (!full && !teaser)) {
    return new ImageResponse(
      (
        <div
          style={{
            width: 1200,
            height: 630,
            background: '#0a0a0a',
            color: '#fafafa',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <svg width="200" height="100" viewBox="0 0 64 32" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 22 L18 22 M46 22 L64 22" stroke="#fafafa" strokeOpacity="0.35" strokeWidth="1.8" strokeLinecap="round" fill="none" />
              <path d="M18 22 L22 26 L32 6 L42 26 L46 22" stroke="#fafafa" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <circle cx="32" cy="6" r="3" fill="#e34a1c" />
            </svg>
            <div style={{ fontSize: 72, fontWeight: 800 }}>
              Deal<span style={{ color: '#e34a1c' }}>Doctor</span>
            </div>
          </div>
          <div style={{ fontSize: 28, marginTop: 16, color: '#a1a1aa' }}>
            Instant underwriting for US rental investments
          </div>
        </div>
      ),
      size
    )
  }

  const address = report.address
  const cityState = `${report.city}, ${report.state}`

  // Prefer full-report numbers, fall back to teaser pre-paywall numbers
  const breakeven = full?.breakeven?.price ?? teaser?.breakevenPrice
  const offer = full?.breakeven?.yourOffer ?? teaser?.estimatedValue
  const delta = full?.breakeven?.delta ?? teaser?.listingVsBreakeven ?? 0
  const verdict = full?.ltr?.verdict as 'DEAL' | 'MARGINAL' | 'PASS' | undefined
  const wealth5yr = full?.wealthProjection?.hero?.totalWealthBuilt5yr
  const irr = full?.wealthProjection?.hero?.irr5yr

  const verdictColor =
    verdict === 'DEAL' ? '#10b981' : verdict === 'MARGINAL' ? '#f59e0b' : verdict === 'PASS' ? '#ef4444' : '#71717a'
  const verdictLabel =
    verdict === 'DEAL' ? 'STRONG DEAL' : verdict === 'MARGINAL' ? 'MARGINAL' : verdict === 'PASS' ? 'PASS' : 'PREVIEW'

  const deltaAbove = delta < 0
  const deltaText = deltaAbove
    ? `${fmt(-delta)} above breakeven`
    : `${fmt(delta)} below breakeven`

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: 'linear-gradient(135deg, #fafafa 0%, #f4f4f5 100%)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '28px 60px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #e4e4e7',
            background: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg width="48" height="24" viewBox="0 0 64 32" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 22 L18 22 M46 22 L64 22" stroke="#18181b" strokeOpacity="0.35" strokeWidth="1.8" strokeLinecap="round" fill="none" />
              <path d="M18 22 L22 26 L32 6 L42 26 L46 22" stroke="#18181b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <circle cx="32" cy="6" r="2.5" fill="#e34a1c" />
            </svg>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#18181b', display: 'flex' }}>
              Deal<span style={{ color: '#e34a1c' }}>Doctor</span>
            </div>
          </div>
          <div
            style={{
              background: verdictColor,
              color: 'white',
              padding: '8px 20px',
              borderRadius: 999,
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: 1,
              display: 'flex',
            }}
          >
            {verdictLabel}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '48px 60px', display: 'flex', flexDirection: 'column' }}>
          {/* Address */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontSize: 44,
                fontWeight: 800,
                color: '#18181b',
                lineHeight: 1.1,
                maxWidth: 1080,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'flex',
              }}
            >
              {address}
            </div>
            <div style={{ fontSize: 22, color: '#71717a', marginTop: 6, display: 'flex' }}>{cityState}</div>
          </div>

          {/* Breakeven hero */}
          {breakeven && offer && (
            <div
              style={{
                marginTop: 36,
                padding: '24px 28px',
                background: deltaAbove ? '#fef2f2' : '#ecfdf5',
                border: `2px solid ${deltaAbove ? '#fca5a5' : '#6ee7b7'}`,
                borderRadius: 16,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: '#71717a', letterSpacing: 1, display: 'flex' }}>
                OFFER VS BREAKEVEN
              </div>
              <div
                style={{
                  fontSize: 40,
                  fontWeight: 800,
                  color: deltaAbove ? '#991b1b' : '#065f46',
                  marginTop: 4,
                  display: 'flex',
                }}
              >
                {deltaText}
              </div>
              <div style={{ fontSize: 18, color: '#52525b', marginTop: 4, display: 'flex' }}>
                Offer {fmt(offer)} · Breakeven {fmt(breakeven)}
              </div>
            </div>
          )}

          {/* Wealth projection */}
          {wealth5yr != null && (
            <div
              style={{
                marginTop: 20,
                padding: '20px 28px',
                background: '#fff7ed',
                border: '1px solid #fed7aa',
                borderRadius: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#71717a', letterSpacing: 1, display: 'flex' }}>
                  5-YEAR WEALTH BUILT
                </div>
                <div style={{ fontSize: 32, fontWeight: 800, color: '#c2410c', marginTop: 2, display: 'flex' }}>
                  {fmt(wealth5yr)}
                </div>
              </div>
              {irr != null && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#71717a', letterSpacing: 1, display: 'flex' }}>
                    IRR
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#18181b', marginTop: 2, display: 'flex' }}>
                    {(irr * 100).toFixed(1)}%
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '18px 60px',
            borderTop: '1px solid #e4e4e7',
            background: '#18181b',
            color: '#a1a1aa',
            fontSize: 16,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ display: 'flex' }}>Real mortgage math · DSCR · AI-powered analysis</span>
          <span style={{ display: 'flex' }}>{DISPLAY_SITE_HOSTNAME}</span>
        </div>
      </div>
    ),
    size
  )
}

export default OGImage
