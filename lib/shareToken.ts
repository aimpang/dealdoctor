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

const DEV_DEFAULT_SECRET = 'dev-default-share-secret-change-in-production'

// In production, refuse to start with an unset or default SHARE_LINK_SECRET.
// Prior behavior logged a warning and fell through to the dev default — but
// the default is a string anyone who can read the repo source knows, so an
// attacker could forge share tokens for any UUID. Fail loud at module load
// instead so a misconfigured deploy never reaches production traffic.
const envSecret = process.env.SHARE_LINK_SECRET
if (process.env.NODE_ENV === 'production') {
  if (!envSecret || envSecret === DEV_DEFAULT_SECRET) {
    throw new Error(
      '[shareToken] SHARE_LINK_SECRET must be set to a strong random value ' +
        'in production (e.g. `openssl rand -hex 32`). The dev default is ' +
        'checked into source and would let anyone forge share tokens.'
    )
  }
}

const TOKEN_SECRET = envSecret || DEV_DEFAULT_SECRET
const SHARE_TOKEN_TTL_DAYS = 30
const SHARE_TOKEN_TTL_MS = SHARE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000

interface ShareTokenPayload {
  exp: number
  uuid: string
}

const signShareTokenPayload = (encodedPayload: string): string =>
  crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(encodedPayload)
    .digest('base64url')
    .slice(0, 24)

const parseShareToken = (candidate: string | null | undefined): {
  encodedPayload: string
  payload: ShareTokenPayload
  signature: string
} | null => {
  if (!candidate) return null
  const [encodedPayload, signature] = candidate.split('.')
  if (!encodedPayload || !signature) return null

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as ShareTokenPayload
    if (
      !payload ||
      typeof payload.uuid !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= Date.now()
    ) {
      return null
    }
    return { encodedPayload, payload, signature }
  } catch {
    return null
  }
}

/**
 * Produce a short base64url HMAC over the report UUID. Deterministic — the
 * same UUID always produces the same token for a given secret. 12 bytes of
 * output is plenty: 2^96 search space, the attacker would still have to
 * guess a 32-char random alphabet to forge.
 */
export function signShareToken(uuid: string, expiresInMs: number = SHARE_TOKEN_TTL_MS): string {
  const payload: ShareTokenPayload = {
    uuid,
    exp: Date.now() + expiresInMs,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = signShareTokenPayload(encodedPayload)
  return `${encodedPayload}.${signature}`
}

export function verifyShareToken(uuid: string, candidate: string | null | undefined): boolean {
  const parsedShareToken = parseShareToken(candidate)
  if (!parsedShareToken || parsedShareToken.payload.uuid !== uuid) return false
  const expectedSignature = signShareTokenPayload(parsedShareToken.encodedPayload)
  if (parsedShareToken.signature.length !== expectedSignature.length) return false
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(parsedShareToken.signature)
    )
  } catch {
    return false
  }
}
