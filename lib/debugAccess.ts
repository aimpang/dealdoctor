// Dev debug-bypass guard for /report/[uuid] and /api/report/[uuid]/export.
//
// Prior state: `?debug=1` was gated only by `NODE_ENV !== 'production'`. A
// leaked `.env`, misconfigured deployment, or local-dev URL sent to the
// wrong audience would expose paid content to anyone who guesses the param.
//
// New contract: TWO gates must pass simultaneously —
//   1. NODE_ENV must NOT be 'production'
//   2. `?debugKey=<secret>` must match env DEBUG_ACCESS_SECRET (when set)
//
// Defense in depth: a single-factor leak (env toggle OR known secret) isn't
// enough on its own. When DEBUG_ACCESS_SECRET is unset in dev, we permit
// `?debug=1` without a key — preserves local productivity. Any non-dev
// environment requires both.

import crypto from 'node:crypto'

export function isDebugAccessAuthorized(debugKey: string | null | undefined): boolean {
  if (process.env.NODE_ENV === 'production') return false

  const required = process.env.DEBUG_ACCESS_SECRET
  if (!required) {
    // Dev convenience: no secret set = any ?debug=1 works. Production
    // deployments will never get here (NODE_ENV gate above).
    return true
  }

  if (!debugKey) return false
  if (debugKey.length !== required.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(debugKey), Buffer.from(required))
  } catch {
    return false
  }
}
