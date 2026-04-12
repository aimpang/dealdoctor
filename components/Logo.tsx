import { cn } from '@/lib/utils'

/**
 * DealDoctor wordmark + diagnostic-pulse mark.
 *
 * The mark is a single continuous stroke that reads as both an EKG pulse and
 * a pitched roof — the conceptual knot that "DealDoctor" is trying to tie.
 *
 * Colors come from the ambient theme via currentColor and the existing
 * --primary CSS variable, so the logo adapts to light/dark mode and respects
 * the brand accent without hard-coded hex values.
 */

type Variant = 'mark' | 'wordmark' | 'stacked'
type Size = 'sm' | 'md' | 'lg' | 'xl'

interface LogoProps {
  variant?: Variant
  size?: Size
  className?: string
  animated?: boolean
  /** Force a mono color for the wordmark instead of split neutral/primary */
  mono?: boolean
}

const MARK_SIZES: Record<Size, { h: number; stroke: number }> = {
  sm: { h: 20, stroke: 3 },
  md: { h: 28, stroke: 3 },
  lg: { h: 44, stroke: 3 },
  xl: { h: 72, stroke: 3 },
}

const WORDMARK_SIZES: Record<Size, string> = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-2xl',
  xl: 'text-4xl',
}

export function Logo({
  variant = 'wordmark',
  size = 'md',
  className,
  animated = false,
  mono = false,
}: LogoProps) {
  const markProps = MARK_SIZES[size]
  const wordClass = WORDMARK_SIZES[size]

  const mark = (
    <svg
      width={markProps.h * 2} // 2:1 aspect
      height={markProps.h}
      viewBox="0 0 64 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="DealDoctor mark"
      className={cn(
        'shrink-0',
        animated && '[&_path]:[stroke-dasharray:180] [&_path]:[stroke-dashoffset:180] [&_path]:animate-[logo-draw_1.1s_cubic-bezier(0.16,1,0.3,1)_forwards]'
      )}
    >
      {/* Subtle baseline — the "flat EKG" before and after the spike, muted */}
      <path
        d="M0 22 L18 22 M46 22 L64 22"
        stroke="currentColor"
        strokeWidth={markProps.stroke * 0.6}
        strokeOpacity={0.35}
        strokeLinecap="round"
      />
      {/* The vital pulse — single continuous stroke with pitched roof apex */}
      <path
        d="M18 22 L22 26 L32 6 L42 26 L46 22"
        stroke="currentColor"
        strokeWidth={markProps.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Accent dot at the peak — the "diagnosis moment" */}
      <circle cx="32" cy="6" r="2" fill="hsl(var(--primary))" />
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

  if (variant === 'stacked') {
    return (
      <span className={cn('inline-flex flex-col items-center gap-1.5', className)}>
        {mark}
        {wordmark}
      </span>
    )
  }

  // wordmark (horizontal)
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {mark}
      {wordmark}
    </span>
  )
}
