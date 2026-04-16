import { describe, expect, it } from 'vitest'
import { resolveMonthlyInsuranceEstimate } from './property-insurance'

describe('resolveMonthlyInsuranceEstimate', () => {
  it('keeps detached-home insurance on the climate-model baseline', () => {
    const estimate = resolveMonthlyInsuranceEstimate({
      annualInsuranceEstimate: 2400,
      propertyType: 'Single Family',
    })

    expect(estimate).toEqual({
      insuranceSource: 'climate-model',
      isHoaAdjusted: false,
      monthlyInsurance: 200,
    })
  })

  it('adjusts condo insurance down when HOA likely carries a master policy', () => {
    const estimate = resolveMonthlyInsuranceEstimate({
      annualInsuranceEstimate: 5496,
      monthlyHoa: 1257,
      propertyType: 'Condo',
    })

    expect(estimate.insuranceSource).toBe('hoa-adjusted-condo')
    expect(estimate.isHoaAdjusted).toBe(true)
    expect(estimate.monthlyInsurance).toBe(183)
  })

  it('adjusts townhouse insurance down when HOA likely covers shared structures', () => {
    const estimate = resolveMonthlyInsuranceEstimate({
      annualInsuranceEstimate: 2347,
      monthlyHoa: 200,
      propertyType: 'Townhouse',
    })

    expect(estimate.insuranceSource).toBe('hoa-adjusted-townhouse')
    expect(estimate.isHoaAdjusted).toBe(true)
    expect(estimate.monthlyInsurance).toBe(147)
  })

  it('falls back to the national baseline when climate data is unavailable', () => {
    const estimate = resolveMonthlyInsuranceEstimate({
      propertyType: 'Single Family',
    })

    expect(estimate).toEqual({
      insuranceSource: 'fallback-national-average',
      isHoaAdjusted: false,
      monthlyInsurance: 150,
    })
  })
})
