'use client'

import { useEffect, useState } from 'react'

// Rotates through friendly descriptions of the stages the backend goes
// through during report generation. The backend is a single blocking call
// so we can't get true stage telemetry without SSE/streaming — this
// component fakes progressive disclosure by cycling every 4.5s, which
// roughly matches the real pipeline. If the work finishes before all
// messages have cycled, the component just unmounts when the outer
// loading flag flips.

const PREVIEW_STAGES = [
  'Looking up this property…',
  'Pulling recent sale comps in the neighborhood…',
  'Cross-checking against Zestimate and public records…',
  'Estimating achievable rent from local comparables…',
  'Checking HOA, taxes, and climate risk…',
  'Solving for the breakeven price…',
  'Wrapping up your free preview…',
]

const FULL_STAGES = [
  'Pulling the property record from Rentcast…',
  'Tracking down recent sale comps in the neighborhood…',
  'Checking the rent comps and zip-level market trends…',
  'Pulling climate risk and FEMA flood-zone data…',
  "Applying the investor-rate premium over today's PMMS…",
  'Solving the breakeven price — the math that moves the deal…',
  'Running the 5-year wealth projection and IRR…',
  'Stress-testing rent, rate, and appreciation scenarios…',
  'Sanity-checking the numbers against themselves…',
  'Asking Claude to write your Deal Doctor diagnosis…',
  'Drafting negotiation scripts with the right dollar amounts…',
  'Flagging inspection items specific to this property…',
  'Wrapping up — writing the bottom line…',
]

interface Props {
  variant?: 'preview' | 'full'
  intervalMs?: number
}

export function FriendlyLoadingMessage({ variant = 'full', intervalMs = 4500 }: Props) {
  const stages = variant === 'preview' ? PREVIEW_STAGES : FULL_STAGES
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % stages.length), intervalMs)
    return () => clearInterval(id)
  }, [stages.length, intervalMs])
  return <>{stages[i]}</>
}
