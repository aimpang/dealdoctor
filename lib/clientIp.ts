// Platform-trusted client IP resolution for rate limiting.
//
// Prior code did `req.headers.get('x-forwarded-for') || 'unknown'`, which
// treats the entire XFF chain as the rate-limit key. An attacker can rotate
// a spoofed `X-Forwarded-For: <fake>` per request — every value produces a
// distinct chain and a distinct bucket key, bypassing the limit and draining
// Rentcast + Anthropic budget at wall speed.
//
// Resolution order, most to least trustworthy:
//   1. NextRequest.ip         — Vercel platform sets this from the TCP layer
//   2. X-Real-IP              — single-value header set by Railway / nginx /
//                                Cloudflare; platform overwrites client input
//   3. X-Forwarded-For[0]     — leftmost entry (Vercel / Railway prepend the
//                                real client here; still spoofable in exotic
//                                self-hosted setups, but better than using
//                                the full chain as a key)
//   4. 'unknown'              — last-resort shared bucket

import type { NextRequest } from 'next/server'

export function getClientIp(req: NextRequest): string {
  const platformIp = (req as { ip?: unknown }).ip
  if (typeof platformIp === 'string' && platformIp.length > 0) {
    return platformIp
  }

  const realIp = req.headers.get('x-real-ip')
  if (realIp) {
    const trimmed = realIp.trim()
    if (trimmed) return trimmed
  }

  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }

  return 'unknown'
}
