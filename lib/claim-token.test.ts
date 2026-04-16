import { describe, expect, it, vi } from 'vitest'
import {
  CLAIM_TOKEN_TTL_MS,
  createClaimToken,
  readClaimTokenPayload,
  verifyClaimToken,
} from './claim-token'

describe('claim token helpers', () => {
  it('accepts a valid token', () => {
    const token = createClaimToken({
      accessToken: 'access-token-123',
      customerId: 'customer-123',
      expiresInMs: CLAIM_TOKEN_TTL_MS,
    })

    expect(verifyClaimToken(token, 'access-token-123')).toMatchObject({
      customerId: 'customer-123',
    })
  })

  it('rejects tampered tokens', () => {
    const token = createClaimToken({
      accessToken: 'access-token-123',
      customerId: 'customer-123',
      expiresInMs: CLAIM_TOKEN_TTL_MS,
    })

    expect(verifyClaimToken(`${token}tampered`, 'access-token-123')).toBeNull()
  })

  it('rejects verification with the wrong access token', () => {
    const token = createClaimToken({
      accessToken: 'access-token-123',
      customerId: 'customer-123',
      expiresInMs: CLAIM_TOKEN_TTL_MS,
    })

    expect(verifyClaimToken(token, 'different-access-token')).toBeNull()
  })

  it('rejects expired tokens', () => {
    vi.useFakeTimers()
    const baseline = new Date('2026-04-16T12:00:00.000Z')
    vi.setSystemTime(baseline)

    const token = createClaimToken({
      accessToken: 'access-token-123',
      customerId: 'customer-123',
      expiresInMs: 1000,
    })

    vi.setSystemTime(new Date(baseline.getTime() + 1001))
    expect(verifyClaimToken(token, 'access-token-123')).toBeNull()

    vi.useRealTimers()
  })

  it('does not leak the access token in the payload', () => {
    const token = createClaimToken({
      accessToken: 'access-token-123',
      customerId: 'customer-123',
      expiresInMs: CLAIM_TOKEN_TTL_MS,
    })

    const payloadSegment = token.split('.')[0]
    expect(Buffer.from(payloadSegment, 'base64url').toString('utf8')).not.toContain(
      'access-token-123'
    )
    expect(readClaimTokenPayload(token)).toMatchObject({
      customerId: 'customer-123',
    })
  })
})
