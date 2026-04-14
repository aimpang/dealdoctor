// Simple in-memory rate limiter — replace with Redis at scale
const requests = new Map<string, { count: number, resetAt: number }>()

export async function rateLimit(ip: string, max = 3): Promise<boolean> {
  // Dev bypass: skip limiting on localhost so the QA loop / e2e tests don't
  // wedge themselves into 429s after 3 iterations.
  if (process.env.NODE_ENV !== 'production') return false

  const now = Date.now()
  const windowMs = 24 * 60 * 60 * 1000  // 24 hours

  const current = requests.get(ip)

  if (!current || current.resetAt < now) {
    requests.set(ip, { count: 1, resetAt: now + windowMs })
    return false  // not limited
  }

  if (current.count >= max) return true  // limited

  current.count++
  return false  // not limited
}
