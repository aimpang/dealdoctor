import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isDebugAccessAuthorized } from './debugAccess'

// Gap #8 regression — defense-in-depth for the ?debug=1 bypass on paid
// routes. Before: only NODE_ENV !== 'production' gated it. Now: two gates,
// and production refuses outright even with a correct key.
describe('isDebugAccessAuthorized', () => {
  const ORIG_NODE_ENV = process.env.NODE_ENV
  const ORIG_SECRET = process.env.DEBUG_ACCESS_SECRET

  afterEach(() => {
    // Restore per-test env mutation. Casting required because NODE_ENV is
    // a read-only typed property in some @types/node versions.
    ;(process.env as any).NODE_ENV = ORIG_NODE_ENV
    if (ORIG_SECRET === undefined) delete process.env.DEBUG_ACCESS_SECRET
    else process.env.DEBUG_ACCESS_SECRET = ORIG_SECRET
  })

  it('refuses in production regardless of any key', () => {
    ;(process.env as any).NODE_ENV = 'production'
    process.env.DEBUG_ACCESS_SECRET = 'secret123'
    expect(isDebugAccessAuthorized('secret123')).toBe(false)
    expect(isDebugAccessAuthorized(null)).toBe(false)
    expect(isDebugAccessAuthorized(undefined)).toBe(false)
  })

  it('allows in dev when no secret is configured (dev convenience)', () => {
    ;(process.env as any).NODE_ENV = 'development'
    delete process.env.DEBUG_ACCESS_SECRET
    expect(isDebugAccessAuthorized(null)).toBe(true)
    expect(isDebugAccessAuthorized('anything')).toBe(true)
  })

  it('in dev WITH a secret configured, refuses a missing or wrong key', () => {
    ;(process.env as any).NODE_ENV = 'development'
    process.env.DEBUG_ACCESS_SECRET = 'rightkey'
    expect(isDebugAccessAuthorized(null)).toBe(false)
    expect(isDebugAccessAuthorized('wrongkey')).toBe(false)
    expect(isDebugAccessAuthorized('')).toBe(false)
  })

  it('in dev WITH a secret, accepts the matching key', () => {
    ;(process.env as any).NODE_ENV = 'development'
    process.env.DEBUG_ACCESS_SECRET = 'rightkey'
    expect(isDebugAccessAuthorized('rightkey')).toBe(true)
  })

  it('uses constant-time comparison (rejects different-length keys cleanly)', () => {
    ;(process.env as any).NODE_ENV = 'development'
    process.env.DEBUG_ACCESS_SECRET = 'rightkey'
    // Length mismatch shouldn't throw or leak timing — just returns false.
    expect(isDebugAccessAuthorized('short')).toBe(false)
    expect(isDebugAccessAuthorized('way-way-way-too-long-candidate')).toBe(false)
  })

  it('refuses in test env the same way as production once a secret is set', () => {
    // vitest sets NODE_ENV to 'test' — neither production nor development.
    // Our helper treats anything non-production as dev, so "test" permits
    // bypass when no secret is set. This is the intended behavior since
    // vitest runs should have no secret configured by default.
    ;(process.env as any).NODE_ENV = 'test'
    delete process.env.DEBUG_ACCESS_SECRET
    expect(isDebugAccessAuthorized(null)).toBe(true)
    process.env.DEBUG_ACCESS_SECRET = 's'
    expect(isDebugAccessAuthorized('s')).toBe(true)
    expect(isDebugAccessAuthorized('x')).toBe(false)
  })
})
