// Signed share-link tokens for /report/[uuid].
//
// Prior state: any knowledge of a report UUID granted full paid-report
// access. A UUID leaked in a forwarded email exposed the report indefinitely.
//
// New contract:
//   - Owner (has matching customer cookie)  → full access, no token needed
//   - Recipient of a signed share link      → full access when token is valid
//   - Anyone else                           → teaser only
//
// The share button generates `/report/<uuid>?t=<hmac>` and recipients get
// full access. Raw-UUID access (no cookie, no token) returns teaser-only —
// existing bookmarks still load, just without the paid content for non-owners.
//
// Refund/revocation: bumping `SHARE_LINK_SECRET` rotates every outstanding
// shared link. No per-customer revocation today; document that as a future
// if we ever need it.

import crypto from 'node:crypto'

const TOKEN_SECRET =
  process.env.SHARE_LINK_SECRET ||
  // Dev default so the feature works without env config. Deploys MUST set
  // a real secret — we log a warning once so it's discoverable.
  (() => {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[shareToken] SHARE_LINK_SECRET is not set in production! ' +
          'Share links will use an insecure default — rotate immediately.'
      )
    }
    return 'dev-default-share-secret-change-in-production'
  })()

/**
 * Produce a short base64url HMAC over the report UUID. Deterministic — the
 * same UUID always produces the same token for a given secret. 12 bytes of
 * output is plenty: 2^96 search space, the attacker would still have to
 * guess a 32-char random alphabet to forge.
 */
export function signShareToken(uuid: string): string {
  return crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(uuid)
    .digest('base64url')
    .slice(0, 16) // 16 chars of base64url = 12 bytes of entropy
}

export function verifyShareToken(uuid: string, candidate: string | null | undefined): boolean {
  if (!candidate) return false
  const expected = signShareToken(uuid)
  if (candidate.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))
  } catch {
    return false
  }
}
