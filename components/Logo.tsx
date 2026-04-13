import { cn } from '@/lib/utils'

/**
 * DealDoctor identity system.
 *
 * The mark is a single continuous stroke that reads as both an EKG pulse
 * and a pitched roof — the conceptual knot that ties "Deal" (housing) to
 * "Doctor" (diagnosis). The orange apex dot is the "diagnostic moment."
 *
 * Variants:
 *   - mark       Graphic only — favicons, avatars, watermarks
 *   - wordmark   Mark + horizontal "DealDoctor" — nav default
 *   - stacked    Mark over centered wordmark — hero, splash
 *   - seal       Circular emblem with arc'd text — certificates, PDF footers
 *
 * Colors flow through currentColor + hsl(var(--primary)) so the identity
 * adapts to light / dark mode without hard-coded hex values.
 */

type Variant = 'mark' | 'wordmark' | 'stacked' | 'seal'
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

interface LogoProps {
  variant?: Variant
  size?: Size
  className?: string
  animated?: boolean
  /** Force mono wordmark (useful on colored backgrounds) */
  mono?: boolean
}

const MARK_SIZES: Record<Size, { h: number; stroke: number; dot: number }> = {
  xs: { h: 16, stroke: 2.6, dot: 1.7 },
  sm: { h: 20, stroke: 2.8, dot: 1.9 },
  md: { h: 28, stroke: 3.0, dot: 2.1 },
  lg: { h: 44, stroke: 3.2, dot: 2.3 },
  xl: { h: 72, stroke: 3.4, dot: 2.5 },
}

const WORDMARK_SIZES: Record<Size, string> = {
  xs: 'text-sm',
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-2xl',
  xl: 'text-4xl',
}

const SEAL_SIZES: Record<Size, number> = {
  xs: 48,
  sm: 64,
  md: 96,
  lg: 144,
  xl: 200,
}

export function Logo({
  variant = 'wordmark',
  size = 'md',
  className,
  animated = false,
  mono = false,
}: LogoProps) {
  const m = MARK_SIZES[size]
  const wordClass = WORDMARK_SIZES[size]

  const mark = (
    <svg
      width={m.h * 2}
      height={m.h}
      viewBox="0 0 64 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="DealDoctor"
      className={cn(
        'shrink-0',
        animated &&
          '[&_path.pulse]:[stroke-dasharray:180] [&_path.pulse]:[stroke-dashoffset:180] [&_path.pulse]:animate-[logo-draw_1.1s_cubic-bezier(0.16,1,0.3,1)_forwards]'
      )}
    >
      <path
        d="M0 22 L18 22 M46 22 L64 22"
        stroke="currentColor"
        strokeWidth={m.stroke * 0.55}
        strokeOpacity={0.32}
        strokeLinecap="round"
      />
      <path
        className="pulse"
        d="M18 22 L22 26 L32 6 L42 26 L46 22"
        stroke="currentColor"
        strokeWidth={m.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="6" r={m.dot} fill="hsl(var(--primary))" />
    </svg>
  )

  const wordmark = (
    <span
      className={cn(
        'font-[family-name:var(--font-playfair)] font-bold tracking-[-0.02em] leading-none',
        wordClass
      )}
    >
      <span className={mono ? '' : 'text-foreground'}>Deal</span>
      <span className={mono ? '' : 'text-primary'}>Doctor</span>
    </span>
  )

  if (variant === 'mark') {
    return <span className={cn('inline-flex', className)}>{mark}</span>
  }

  if (variant === 'seal') {
    const s = SEAL_SIZES[size]
    return (
      <span className={cn('inline-flex', className)} aria-label="DealDoctor seal">
        <svg
          width={s}
          height={s}
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="DealDoctor seal"
        >
          {/* Concentric hairline rings — outer, mid, inner for depth */}
          <circle cx="50" cy="50" r="49" stroke="currentColor" strokeWidth="0.35" strokeOpacity="0.55" />
          <circle cx="50" cy="50" r="44.5" stroke="currentColor" strokeWidth="0.25" strokeOpacity="0.4" />
          <circle cx="50" cy="50" r="30" stroke="currentColor" strokeWidth="0.22" strokeOpacity="0.25" />

          {/* Arc paths for curved text */}
          <defs>
            <path id="dd-arc-top" d="M 13,50 A 37,37 0 0,1 87,50" fill="none" />
            <path id="dd-arc-bot" d="M 15,50 A 35,35 0 0,0 85,50" fill="none" />
          </defs>

          {/* Top arc — brand name in small caps with generous tracking */}
          <text
            style={{
              fontFamily: 'var(--font-playfair), Georgia, serif',
              fontSize: '7.5px',
              fontWeight: 600,
              letterSpacing: '0.42em',
            }}
            fill="currentColor"
          >
            <textPath href="#dd-arc-top" startOffset="50%" textAnchor="middle">
              DEAL DOCTOR
            </textPath>
          </text>

          {/* Bottom arc — establishment mark, Roman numeral for 2026 */}
          <text
            style={{
              fontFamily: 'var(--font-playfair), Georgia, serif',
              fontSize: '4.8px',
              fontWeight: 500,
              letterSpacing: '0.38em',
            }}
            fill="currentColor"
            fillOpacity="0.65"
          >
            <textPath href="#dd-arc-bot" startOffset="50%" textAnchor="middle">
              EST · MMXXVI
            </textPath>
          </text>

          {/* Diamond pips at 3 and 9 o'clock break the text ring */}
          <path d="M 8,50 l 2,-2 l 2,2 l -2,2 Z" fill="currentColor" fillOpacity="0.55" />
          <path d="M 92,50 l -2,-2 l -2,2 l 2,2 Z" fill="currentColor" fillOpacity="0.55" />

          {/* Central mark — scaled from 64×32 viewBox and re-centered on (50,50) */}
          <g transform="translate(50 50) scale(0.55) translate(-32 -14)">
            <path
              d="M0 22 L18 22 M46 22 L64 22"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeOpacity="0.32"
              strokeLinecap="round"
            />
            <path
              d="M18 22 L22 26 L32 6 L42 26 L46 22"
              stroke="currentColor"
              strokeWidth="3.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <circle cx="32" cy="6" r="2.4" fill="hsl(var(--primary))" />
          </g>
        </svg>
      </span>
    )
  }

  if (variant === 'stacked') {
    return (
      <span className={cn('inline-flex flex-col items-center gap-1.5', className)}>
        {mark}
        {wordmark}
      </span>
    )
  }

  // wordmark (horizontal) — default
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {mark}
      {wordmark}
    </span>
  )
}
