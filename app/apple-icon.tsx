import { ImageResponse } from 'next/og'

// Apple touch icon (iOS home-screen, macOS Safari pin) — 180×180 PNG.
// Uses the full mark with generous padding so it's recognizable at any scale.

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
          background: '#18181b',
          borderRadius: 32,
        }}
      >
        <svg
          width="128"
          height="64"
          viewBox="0 0 64 32"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 22 L18 22 M46 22 L64 22"
            stroke="#fafafa"
            strokeOpacity="0.35"
            strokeWidth="1.8"
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
          <circle cx="32" cy="6" r="2.5" fill="#f97316" />
        </svg>
      </div>
    ),
    size
  )
}
