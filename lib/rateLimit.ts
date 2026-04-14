// Postgres-backed rate limiter. Replaces a prior in-memory Map which did
// not survive cold starts or share state across serverless instances — an
// attacker could burn Rentcast + Anthropic budgets by cycling through
// Vercel/Railway instances.
//
// Design: keys are `${bucket}:${identifier}:${windowId}` where
//   windowId = floor(now / windowMs)
// so each window naturally gets its own row, upsert+increment is atomic at
// the DB level, and expired rows age out by themselves. Opportunistic GC
// runs on ~1% of calls to delete rows older than 2 × windowMs.
//
// Fails OPEN on DB errors — a transient Postgres issue should not block
// legit users from submitting their address.

import { prisma } from './db'

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

type RateLimitOpts = {
  bucket?: string
  windowMs?: number
}

/**
 * Returns true if the caller is rate-limited (should be refused), false
 * if the request should proceed. Back-compat signature matches the prior
 * in-memory implementation: existing callers (`rateLimit(ip)`,
 * `rateLimit(ip, max)`) keep working unchanged.
 */
export async function rateLimit(
  identifier: string,
  max = 3,
  opts: RateLimitOpts = {}
): Promise<boolean> {
  // Dev bypass: skip limiting outside production so local QA / e2e tests
  // don't wedge themselves into 429s after a few iterations.
  if (process.env.NODE_ENV !== 'production') return false

  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS
  const bucket = opts.bucket ?? 'default'
  const now = Date.now()
  const windowId = Math.floor(now / windowMs)
  const key = `${bucket}:${identifier}:${windowId}`

  // Opportunistic GC — fire-and-forget on ~1% of calls. Two windows of
  // grace so we don't race with a bucket that's still being incremented.
  if (Math.random() < 0.01) {
    prisma.rateLimitBucket
      .deleteMany({
        where: { windowStart: { lt: new Date(now - 2 * windowMs) } },
      })
      .catch(() => {
        // GC failure is inconsequential — rows are cheap and the next
        // GC pass will clean them up.
      })
  }

  try {
    const row = await prisma.rateLimitBucket.upsert({
      where: { key },
      create: { key, count: 1, windowStart: new Date(now) },
      update: { count: { increment: 1 } },
      select: { count: true },
    })
    return row.count > max
  } catch (err) {
    // Fail open — a DB hiccup should not lock out legit users. The call
    // we're protecting (Rentcast, Anthropic) has its own quota guards.
    console.error('[rateLimit] DB error, failing open:', err)
    return false
  }
}
