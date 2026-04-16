import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_NODE_ENV = process.env.NODE_ENV
const ORIGINAL_PROPERTY_API_KEY = process.env.PROPERTY_API_KEY

describe('searchProperty configuration behavior', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.PROPERTY_API_KEY
  })

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
    if (ORIGINAL_PROPERTY_API_KEY === undefined) {
      delete process.env.PROPERTY_API_KEY
    } else {
      process.env.PROPERTY_API_KEY = ORIGINAL_PROPERTY_API_KEY
    }
  })

  it('fails closed in production when PROPERTY_API_KEY is missing', async () => {
    process.env.NODE_ENV = 'production'

    const { searchProperty } = await import('./propertyApi')
    const property = await searchProperty('123 Main St, Austin, TX 78701')

    expect(property).toBeNull()
  })

  it('still returns stub data in development when PROPERTY_API_KEY is missing', async () => {
    process.env.NODE_ENV = 'development'

    const { searchProperty } = await import('./propertyApi')
    const property = await searchProperty('123 Main St, Austin, TX 78701')

    expect(property).not.toBeNull()
    expect(property?.listing_price_status).toBe('resolved')
    expect(property?.city).toBe('Austin')
    expect(property?.state).toBe('TX')
  })
})
