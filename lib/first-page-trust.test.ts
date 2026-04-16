import { describe, expect, it } from 'vitest'
import { evaluateFirstPageTrust } from './first-page-trust'

describe('evaluateFirstPageTrust', () => {
  it('keeps page one trusted when the key inputs are verified', () => {
    const assessment = evaluateFirstPageTrust({
      listingPriceSource: 'primary',
      listingPriceStatus: 'resolved',
      monthlyNetCashFlow: 425,
      propertyTaxSource: 'county-record',
      propertyType: 'Single Family',
      rawScore: 90,
      sameBuildingRentCompCount: 2,
      totalRentCompCount: 4,
      valueConfidence: 'high',
    })

    expect(assessment.status).toBe('trusted')
    expect(assessment.investorSignal).toBe('invest')
    expect(assessment.adjustedScore).toBe(86)
    expect(assessment.suppressBreakevenSignal).toBe(false)
    expect(assessment.suppressForwardProjection).toBe(false)
    expect(assessment.breakevenMessage).toBeNull()
    expect(assessment.projectionMessage).toBeNull()
  })

  it('downgrades page one to caution when critical fields are estimated but not broken', () => {
    const assessment = evaluateFirstPageTrust({
      listingPriceSource: 'fallback',
      listingPriceStatus: 'resolved',
      monthlyNetCashFlow: 180,
      propertyTaxSource: 'city-override',
      propertyType: 'Single Family',
      rawScore: 74,
      totalRentCompCount: 1,
      valueConfidence: 'medium',
    })

    expect(assessment.status).toBe('caution')
    expect(assessment.investorSignal).toBe('think')
    expect(assessment.fields.listingPrice.status).toBe('supported')
    expect(assessment.fields.propertyTax.status).toBe('estimated')
    expect(assessment.fields.rent.status).toBe('estimated')
    expect(assessment.suppressBreakevenSignal).toBe(false)
    expect(assessment.suppressForwardProjection).toBe(false)
  })

  it('downgrades page one to caution when the ask was manually reconciled against conflicting sources', () => {
    const assessment = evaluateFirstPageTrust({
      fallbackListingPrice: 275_000,
      listingPriceCheckedAt: '2026-04-16T12:00:00.000Z',
      listingPriceSource: 'user-confirmed',
      listingPriceStatus: 'resolved',
      listingPriceUserSupplied: true,
      monthlyNetCashFlow: -80,
      primaryListingPrice: 295_000,
      propertyTaxSource: 'county-record',
      propertyType: 'Townhouse',
      rawScore: 62,
      reportWarnings: [],
      insuranceSource: 'hoa-adjusted-townhouse',
      totalRentCompCount: 4,
      valueConfidence: 'high',
    })

    expect(assessment.status).toBe('caution')
    expect(assessment.fields.listingPrice.status).toBe('estimated')
    expect(assessment.investorSignal).toBe('think')
  })

  it('marks unsupported condo cases as run when rent and HOA inputs are weak', () => {
    const assessment = evaluateFirstPageTrust({
      climateFloodInsuranceRequired: true,
      hoaSource: 'inferred-condo-default',
      listingPriceSource: 'user-confirmed',
      listingPriceStatus: 'resolved',
      monthlyNetCashFlow: -125,
      propertyTaxSource: 'county-record',
      propertyType: 'Condo',
      rawScore: 82,
      rentWarnings: ['Rent estimate conflicts with nearby comps.'],
      reportWarnings: [
        {
          code: 'florida-condo-insurance-diligence',
          message: 'Insurance needs manual review.',
        },
      ],
      totalRentCompCount: 1,
      valueConfidence: 'low',
    })

    expect(assessment.status).toBe('unsupported')
    expect(assessment.investorSignal).toBe('run')
    expect(assessment.prominentIssues).toEqual(
      expect.arrayContaining(['rent', 'hoa', 'insurance', 'value'])
    )
    expect(assessment.suppressBreakevenSignal).toBe(true)
    expect(assessment.suppressForwardProjection).toBe(true)
    expect(assessment.breakevenMessage).toContain('rent')
    expect(assessment.breakevenMessage).toContain('hoa')
    expect(assessment.projectionMessage).toContain('rent')
    expect(assessment.projectionMessage).toContain('hoa')
  })

  it('blocks page one when the listing price is unresolved', () => {
    const assessment = evaluateFirstPageTrust({
      listingPriceStatus: 'missing',
      monthlyNetCashFlow: 250,
      propertyTaxSource: 'county-record',
      propertyType: 'Single Family',
      rawScore: 91,
      sameBuildingRentCompCount: 2,
      totalRentCompCount: 4,
      valueConfidence: 'high',
    })

    expect(assessment.status).toBe('unsupported')
    expect(assessment.fields.listingPrice.status).toBe('weak')
    expect(assessment.suppressBreakevenSignal).toBe(true)
    expect(assessment.breakevenMessage).toContain('listing price')
  })

  it('blocks page one when a manual ask confirmation is stale', () => {
    const assessment = evaluateFirstPageTrust({
      listingPriceCheckedAt: '2026-04-14T12:00:00.000Z',
      listingPriceSource: 'user-confirmed',
      listingPriceStatus: 'resolved',
      listingPriceUserSupplied: true,
      monthlyNetCashFlow: 250,
      propertyTaxSource: 'county-record',
      propertyType: 'Single Family',
      rawScore: 91,
      referenceTimeMs: Date.parse('2026-04-16T13:00:00.000Z'),
      sameBuildingRentCompCount: 2,
      totalRentCompCount: 4,
      valueConfidence: 'high',
    })

    expect(assessment.status).toBe('unsupported')
    expect(assessment.fields.listingPrice.status).toBe('weak')
    expect(assessment.breakevenMessage).toContain('listing price')
  })
})
