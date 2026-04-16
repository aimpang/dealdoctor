import { describe, expect, it } from 'vitest'
import {
  buildAuthorityAudit,
  buildMarketAudit,
  buildPropertyProfileAudit,
  isUnsupportedPropertyType,
} from './qualityAudit'

describe('property profile support gate', () => {
  it('treats land as unsupported for residential underwriting', () => {
    expect(isUnsupportedPropertyType('Land')).toBe(true)
    const audit = buildPropertyProfileAudit({ propertyType: 'Land' })
    expect(audit.status).toBe('blocked')
    expect(audit.hardFailures.map((f) => f.code)).toContain('unsupported-property-type')
  })

  it('treats commercial classes as unsupported', () => {
    expect(isUnsupportedPropertyType('Retail')).toBe(true)
    expect(isUnsupportedPropertyType('Mixed Use')).toBe(true)
  })

  it('allows residential classes the current product actually models', () => {
    expect(isUnsupportedPropertyType('Single Family')).toBe(false)
    expect(isUnsupportedPropertyType('Townhouse')).toBe(false)
    expect(isUnsupportedPropertyType('Condo')).toBe(false)
    expect(isUnsupportedPropertyType('Manufactured')).toBe(false)
  })

  it('blocks residential-looking subjects with impossible rent-to-value plus tax-assessment anchors', () => {
    const audit = buildPropertyProfileAudit({
      propertyType: 'Single Family',
      estimatedValue: 27_476_547,
      squareFeet: 1800,
      monthlyRent: 1370,
      valueSource: 'tax-assessment',
    })

    expect(audit.status).toBe('blocked')
    expect(audit.hardFailures.map((f) => f.code)).toContain('residential-profile-mismatch')
  })

  it('does not block a normal residential rental profile', () => {
    const audit = buildPropertyProfileAudit({
      propertyType: 'Townhouse',
      estimatedValue: 282_000,
      squareFeet: 1407,
      monthlyRent: 2320,
      valueSource: 'avm',
    })

    expect(audit.status).toBe('passed')
  })
})

describe('buildAuthorityAudit', () => {
  it('blocks when state rules are missing and the report would fall back to TX defaults', () => {
    const audit = buildAuthorityAudit({
      state: 'NM',
      city: 'Santa Fe',
      stateRulesMissing: true,
      propertyTaxSource: 'state-average',
    })

    expect(audit.status).toBe('blocked')
    expect(audit.hardFailures.map((f) => f.code)).toContain('state-rules-missing')
  })

  it('passes but warns when property tax is using a fallback estimate', () => {
    const audit = buildAuthorityAudit({
      state: 'TX',
      city: 'Austin',
      stateRulesMissing: false,
      propertyTaxSource: 'state-average',
    })

    expect(audit.status).toBe('passed')
    expect(audit.warnings.map((f) => f.code)).toContain('property-tax-fallback')
  })
})

describe('buildMarketAudit', () => {
  it('flags low-confidence value signals and rent warnings', () => {
    const audit = buildMarketAudit({
      checkedAt: '2026-04-15T00:00:00.000Z',
      valueConfidence: 'low',
      valueSpread: 0.56,
      reportWarnings: [
        {
          code: 'avm-extremely-wide',
          message: 'Value AVM has an extremely wide confidence band.',
        },
      ],
      rentWarnings: [
        'Rent AVM ($1,850/mo) is >25% below rent-comps median ($2,500/mo).',
      ],
      crossCheckLinks: {
        zillow: 'https://example.com/zillow',
        redfin: 'https://example.com/redfin',
        realtor: 'https://example.com/realtor',
      },
    })

    expect(audit.status).toBe('warning')
    expect(audit.findings.map((f) => f.code)).toContain('value-confidence-low')
    expect(audit.findings.map((f) => f.code)).toContain('rent-cross-check-recommended')
  })

  it('returns clean when no market concerns exist', () => {
    const audit = buildMarketAudit({
      checkedAt: '2026-04-15T00:00:00.000Z',
      valueConfidence: 'high',
      valueSpread: 0.08,
      reportWarnings: [],
      rentWarnings: [],
      crossCheckLinks: {
        zillow: 'https://example.com/zillow',
        redfin: 'https://example.com/redfin',
        realtor: 'https://example.com/realtor',
      },
    })

    expect(audit.status).toBe('clean')
    expect(audit.findings).toEqual([])
  })
})
