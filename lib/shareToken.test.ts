import { describe, it, expect, vi } from 'vitest'
import { signShareToken, verifyShareToken } from './shareToken'

// Gap #4 regression — signed share-link tokens. Without these, anyone who
// had a report UUID (via a forwarded email, etc.) got full paid access
// forever. Tokens bind the shared URL to the report UUID + a secret, so a
// leaked raw UUID alone cannot grant access.
describe('signShareToken / verifyShareToken', () => {
  it('verifies a valid token', () => {
    const token = signShareToken('abc-123', 60_000)
    expect(verifyShareToken('abc-123', token)).toBe(true)
  })

  it('rejects a token for a different uuid', () => {
    const token = signShareToken('uuid-A', 60_000)
    expect(verifyShareToken('uuid-B', token)).toBe(false)
  })

  it('rejects null / undefined / empty token', () => {
    expect(verifyShareToken('uuid', null)).toBe(false)
    expect(verifyShareToken('uuid', undefined)).toBe(false)
    expect(verifyShareToken('uuid', '')).toBe(false)
  })

  it('rejects malformed tokens', () => {
    expect(verifyShareToken('uuid', 'too-short')).toBe(false)
    expect(verifyShareToken(
      'uuid',
      'way-way-way-way-way-way-way-way-too-long-token'
    )).toBe(false)
  })

  it('rejects a single-character flip in an otherwise-valid token', () => {
    const uuid = 'x'
    const t = signShareToken(uuid, 60_000)
    const flipped = (t[t.length - 1] === 'a' ? 'b' : 'a') + t.slice(1)
    expect(verifyShareToken(uuid, flipped)).toBe(false)
  })

  it('expires tokens', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-16T12:00:00Z'))
    const token = signShareToken('expiring-report', 1_000)
    vi.advanceTimersByTime(1_500)
    expect(verifyShareToken('expiring-report', token)).toBe(false)
    vi.useRealTimers()
  })

  it('produces a payload.signature token shape', () => {
    const token = signShareToken('any-uuid', 60_000)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })
})
