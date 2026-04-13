import { ImageResponse } from 'next/og'

// Apple touch icon (iOS home-screen, macOS Safari pin) — 180×180 PNG.
// Generous padding + radial vignette so the mark feels deliberate at any scale.

export const runtime = 'edge'
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(ellipse at 30% 20%, #27272a 0%, #0f0f10 80%)',
          borderRadius: 32,
          position: 'relative',
        }}
      >
        {/* Thin inset border for a minted-coin feel */}
        <div
          style={{
            position: 'absolute',
            inset: 10,
            borderRadius: 24,
            border: '1px solid rgba(250,250,250,0.08)',
            display: 'flex',
          }}
        />
        <svg
          width="120"
          height="60"
          viewBox="0 0 64 32"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 22 L18 22 M46 22 L64 22"
            stroke="#fafafa"
            strokeOpacity="0.3"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M18 22 L22 26 L32 6 L42 26 L46 22"
            stroke="#fafafa"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="32" cy="6" r="2.6" fill="#e34a1c" />
        </svg>
      </div>
    ),
    size
  )
}
