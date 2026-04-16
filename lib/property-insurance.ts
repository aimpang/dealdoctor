export interface ResolveMonthlyInsuranceEstimateInput {
  annualInsuranceEstimate?: number | null
  floodInsuranceRequired?: boolean
  monthlyHoa?: number | null
  propertyType?: string | null
}

export interface MonthlyInsuranceEstimate {
  insuranceSource:
    | 'climate-model'
    | 'hoa-adjusted-condo'
    | 'hoa-adjusted-townhouse'
    | 'fallback-national-average'
  isHoaAdjusted: boolean
  monthlyInsurance: number
}

const NATIONAL_BASELINE_ANNUAL_INSURANCE_USD = 1_800
const MONTHS_PER_YEAR = 12
const HOA_CONDO_INSURANCE_SHARE_RATIO = 0.4
const HOA_CONDO_FLOOD_REQUIRED_SHARE_RATIO = 0.55
const HOA_TOWNHOUSE_INSURANCE_SHARE_RATIO = 0.75
const HOA_TOWNHOUSE_FLOOD_REQUIRED_SHARE_RATIO = 0.85
const MIN_CONDO_POLICY_MONTHLY_INSURANCE_USD = 85
const MIN_TOWNHOUSE_POLICY_MONTHLY_INSURANCE_USD = 110

const isCondoLikePropertyType = (propertyType?: string | null): boolean => {
  return /condo|apartment|co-?op|coop|high[\s-]?rise/i.test(propertyType || '')
}

const isTownhouseLikePropertyType = (propertyType?: string | null): boolean => {
  return /townhouse|townhome|rowhouse/i.test(propertyType || '')
}

export const resolveMonthlyInsuranceEstimate = (
  input: ResolveMonthlyInsuranceEstimateInput
): MonthlyInsuranceEstimate => {
  const annualInsuranceEstimate =
    typeof input.annualInsuranceEstimate === 'number' && input.annualInsuranceEstimate > 0
      ? input.annualInsuranceEstimate
      : NATIONAL_BASELINE_ANNUAL_INSURANCE_USD
  const monthlyHoa = typeof input.monthlyHoa === 'number' ? input.monthlyHoa : 0
  const floodInsuranceRequired = Boolean(input.floodInsuranceRequired)
  const propertyType = input.propertyType ?? null

  if (monthlyHoa > 0 && isCondoLikePropertyType(propertyType)) {
    const condoShareRatio = floodInsuranceRequired
      ? HOA_CONDO_FLOOD_REQUIRED_SHARE_RATIO
      : HOA_CONDO_INSURANCE_SHARE_RATIO

    return {
      insuranceSource: 'hoa-adjusted-condo',
      isHoaAdjusted: true,
      monthlyInsurance: Math.max(
        MIN_CONDO_POLICY_MONTHLY_INSURANCE_USD,
        Math.round((annualInsuranceEstimate * condoShareRatio) / MONTHS_PER_YEAR)
      ),
    }
  }

  if (monthlyHoa > 0 && isTownhouseLikePropertyType(propertyType)) {
    const townhouseShareRatio = floodInsuranceRequired
      ? HOA_TOWNHOUSE_FLOOD_REQUIRED_SHARE_RATIO
      : HOA_TOWNHOUSE_INSURANCE_SHARE_RATIO

    return {
      insuranceSource: 'hoa-adjusted-townhouse',
      isHoaAdjusted: true,
      monthlyInsurance: Math.max(
        MIN_TOWNHOUSE_POLICY_MONTHLY_INSURANCE_USD,
        Math.round((annualInsuranceEstimate * townhouseShareRatio) / MONTHS_PER_YEAR)
      ),
    }
  }

  return {
    insuranceSource: input.annualInsuranceEstimate ? 'climate-model' : 'fallback-national-average',
    isHoaAdjusted: false,
    monthlyInsurance: Math.round(annualInsuranceEstimate / MONTHS_PER_YEAR),
  }
}
