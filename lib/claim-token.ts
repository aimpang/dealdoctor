import crypto from 'node:crypto'

interface ClaimTokenInput {
  accessToken: string
  customerId: string
  expiresInMs: number
}

interface ClaimTokenPayload {
  customerId: string
  exp: number
}

interface ParsedClaimToken {
  encodedPayload: string
  payload: ClaimTokenPayload
  signature: string
}

const CLAIM_TOKEN_SECRET_FALLBACK = 'dev-claim-token-secret-change-in-production'
const CLAIM_TOKEN_SECRET =
  process.env.MAGIC_LINK_SECRET ||
  process.env.SHARE_LINK_SECRET ||
  CLAIM_TOKEN_SECRET_FALLBACK

if (process.env.NODE_ENV === 'production' && CLAIM_TOKEN_SECRET === CLAIM_TOKEN_SECRET_FALLBACK) {
  throw new Error(
    '[claimToken] MAGIC_LINK_SECRET or SHARE_LINK_SECRET must be set in production.'
  )
}

const signClaimTokenPayload = (
  encodedPayload: string,
  accessToken: string
): string =>
  crypto
    .createHmac('sha256', CLAIM_TOKEN_SECRET)
    .update(`${encodedPayload}.${accessToken}`)
    .digest('base64url')

const parseClaimToken = (token: string | null | undefined): ParsedClaimToken | null => {
  if (!token) return null
  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) return null

  try {
    const parsedPayload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as ClaimTokenPayload

    if (
      !parsedPayload ||
      typeof parsedPayload.customerId !== 'string' ||
      typeof parsedPayload.exp !== 'number'
    ) {
      return null
    }

    if (parsedPayload.exp <= Date.now()) return null

    return {
      encodedPayload,
      payload: parsedPayload,
      signature,
    }
  } catch {
    return null
  }
}

export const CLAIM_TOKEN_TTL_MINUTES = 30
export const CLAIM_TOKEN_TTL_MS = CLAIM_TOKEN_TTL_MINUTES * 60 * 1000
export const RECEIPT_CLAIM_TOKEN_TTL_DAYS = 7
export const RECEIPT_CLAIM_TOKEN_TTL_MS = RECEIPT_CLAIM_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000

export const createClaimToken = (input: ClaimTokenInput): string => {
  const payload: ClaimTokenPayload = {
    customerId: input.customerId,
    exp: Date.now() + input.expiresInMs,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = signClaimTokenPayload(encodedPayload, input.accessToken)
  return `${encodedPayload}.${signature}`
}

export const readClaimTokenPayload = (token: string | null | undefined): ClaimTokenPayload | null =>
  parseClaimToken(token)?.payload ?? null

export const verifyClaimToken = (
  token: string | null | undefined,
  accessToken: string
): ClaimTokenPayload | null => {
  const parsedClaimToken = parseClaimToken(token)
  if (!parsedClaimToken) return null

  const expectedSignature = signClaimTokenPayload(
    parsedClaimToken.encodedPayload,
    accessToken
  )
  if (parsedClaimToken.signature.length !== expectedSignature.length) return null
  if (
    !crypto.timingSafeEqual(
      Buffer.from(parsedClaimToken.signature),
      Buffer.from(expectedSignature)
    )
  ) {
    return null
  }

  return parsedClaimToken.payload
}
