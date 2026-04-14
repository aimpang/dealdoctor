import { describe, it, expect, beforeEach, vi } from 'vitest'
import { signShareToken, verifyShareToken } from './shareToken'

// Gap #4 regression — signed share-link tokens. Without these, anyone who
// had a report UUID (via a forwarded email, etc.) got full paid access
// forever. Tokens bind the shared URL to the report UUID + a secret, so a
// leaked raw UUID alone cannot grant access.
describe('signShareToken / verifyShareToken', () => {
  it('produces a deterministic token for a given UUID (same in = same out)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const a = signShareToken(uuid)
    const b = signShareToken(uuid)
    expect(a).toBe(b)
  })

  it('produces DIFFERENT tokens for different UUIDs', () => {
    const a = signShareToken('550e8400-e29b-41d4-a716-446655440000')
    const b = signShareToken('550e8400-e29b-41d4-a716-446655440001')
    expect(a).not.toBe(b)
  })

  it('verifies a valid token', () => {
    const uuid = 'abc-123'
    const t = signShareToken(uuid)
    expect(verifyShareToken(uuid, t)).toBe(true)
  })

  it('rejects a token forged for a different UUID', () => {
    const t = signShareToken('uuid-A')
    expect(verifyShareToken('uuid-B', t)).toBe(false)
  })

  it('rejects null / undefined / empty token', () => {
    expect(verifyShareToken('uuid', null)).toBe(false)
    expect(verifyShareToken('uuid', undefined)).toBe(false)
    expect(verifyShareToken('uuid', '')).toBe(false)
  })

  it('rejects a token of the wrong length (constant-time guard)', () => {
    expect(verifyShareToken('uuid', 'too-short')).toBe(false)
    expect(verifyShareToken(
      'uuid',
      'way-way-way-way-way-way-way-way-too-long-token'
    )).toBe(false)
  })

  it('rejects a single-character flip in an otherwise-valid token', () => {
    const uuid = 'x'
    const t = signShareToken(uuid)
    // flip the first character
    const flipped = (t[0] === 'a' ? 'b' : 'a') + t.slice(1)
    expect(verifyShareToken(uuid, flipped)).toBe(false)
  })

  it('produces a token of reasonable length (16 chars base64url)', () => {
    const t = signShareToken('any-uuid')
    expect(t).toHaveLength(16)
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
