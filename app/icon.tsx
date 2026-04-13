import { ImageResponse } from 'next/og'

// Browser tab favicon — 32×32 PNG rendered from the DealDoctor mark.
// The pulse/roof silhouette is sized down to stay legible at 16px.
// Background uses a subtle radial vignette for depth rather than a flat card.

export const runtime = 'edge'
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(ellipse at center, #1f1f22 0%, #0f0f10 100%)',
          borderRadius: 6,
        }}
      >
        <svg
          width="22"
          height="11"
          viewBox="0 0 64 32"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 22 L18 22 M46 22 L64 22"
            stroke="#fafafa"
            strokeOpacity="0.32"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M18 22 L22 26 L32 6 L42 26 L46 22"
            stroke="#fafafa"
            strokeWidth="3.2"
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
