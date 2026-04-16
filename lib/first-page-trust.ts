import {
  hasMaterialListingPriceConflict,
  isListingPriceCheckStale,
} from './listing-price-resolution'
import {
  getLaunchTrustContracts,
  getLaunchTrustMetricContract,
  type LaunchTrustFieldKey,
} from './launch-trust-contract'

const CRITICAL_WEAK_FIELD_PENALTY_POINTS = 16
const CRITICAL_ESTIMATED_FIELD_PENALTY_POINTS = 6
const SECONDARY_WEAK_FIELD_PENALTY_POINTS = 8
const SECONDARY_ESTIMATED_FIELD_PENALTY_POINTS = 4
const MAX_FIRST_PAGE_PENALTY_POINTS = 40
const INVEST_SCORE_THRESHOLD = 80
const THINK_SCORE_THRESHOLD = 40

export interface FirstPageTrustReportWarning {
  code: string
  message: string
}

export interface FirstPageTrustField {
  label: string
  message: string
  status: 'verified' | 'supported' | 'estimated' | 'weak'
}

export interface FirstPageTrustFields {
  facts: FirstPageTrustField
  hoa: FirstPageTrustField
  insurance: FirstPageTrustField
  listingPrice: FirstPageTrustField
  propertyTax: FirstPageTrustField
  rent: FirstPageTrustField
  value: FirstPageTrustField
}

export interface FirstPageTrustAssessment {
  adjustedScore: number
  breakevenMessage: string | null
  investorSignal: 'invest' | 'think' | 'run'
  prominentIssues: string[]
  projectionMessage: string | null
  scorePenalty: number
  status: 'trusted' | 'caution' | 'unsupported'
  summary: string
  suppressBreakevenSignal: boolean
  suppressForwardProjection: boolean
  fields: FirstPageTrustFields
}

export interface EvaluateFirstPageTrustInput {
  bathrooms?: number | null
  bedrooms?: number | null
  climateFloodInsuranceRequired?: boolean
  dataCompleteness?: 'full' | 'avm-only' | null
  hoaSource?: 'listing' | 'building-avg' | 'inferred-condo-default' | 'not-captured' | null
  insuranceSource?:
    | 'climate-model'
    | 'hoa-adjusted-condo'
    | 'hoa-adjusted-townhouse'
    | 'fallback-national-average'
    | null
  listingPriceCheckedAt?: string | null
  listingPriceUserSupplied?: boolean
  fallbackListingPrice?: number | null
  listingPriceSource?: 'primary' | 'fallback' | 'user-confirmed' | null
  listingPriceStatus?: 'resolved' | 'missing' | 'conflicted' | null
  monthlyNetCashFlow: number
  primaryListingPrice?: number | null
  propertyTaxSource?: 'county-record' | 'city-override' | 'state-average' | null
  propertyType?: string | null
  rawScore: number
  rentWarnings?: string[]
  reportWarnings?: FirstPageTrustReportWarning[]
  referenceTimeMs?: number
  squareFeet?: number | null
  sameBuildingRentCompCount?: number
  taxLikelyExempted?: boolean
  totalRentCompCount?: number
  valueConfidence?: 'high' | 'medium' | 'low' | null
  yearBuilt?: number | null
}

const isCondoLikeProperty = (propertyType?: string | null): boolean => {
  return /condo|apartment|co[- ]?op|high[\s-]?rise/i.test(propertyType || '')
}

const isHoaSensitiveProperty = (propertyType?: string | null): boolean => {
  return /condo|apartment|co[- ]?op|high[\s-]?rise|townhouse|townhome|rowhouse/i.test(
    propertyType || ''
  )
}

const isPresentNumber = (value?: number | null): boolean => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

const buildField = (
  label: string,
  status: FirstPageTrustField['status'],
  message: string
): FirstPageTrustField => ({
  label,
  message,
  status,
})

const hasWarningCode = (
  reportWarnings: FirstPageTrustReportWarning[],
  code: string
): boolean => {
  return reportWarnings.some((warning) => warning.code === code)
}

const calculatePenalty = (
  fields: FirstPageTrustFields
): number => {
  let scorePenalty = 0
  const fieldContracts = getLaunchTrustContracts()

  for (const fieldContract of fieldContracts) {
    const field = fields[fieldContract.fieldKey]
    if (fieldContract.requiredForTrusted && field.status === 'weak') {
      scorePenalty += CRITICAL_WEAK_FIELD_PENALTY_POINTS
    } else if (fieldContract.requiredForTrusted && field.status === 'estimated') {
      scorePenalty += CRITICAL_ESTIMATED_FIELD_PENALTY_POINTS
    } else if (!fieldContract.requiredForTrusted && field.status === 'weak') {
      scorePenalty += SECONDARY_WEAK_FIELD_PENALTY_POINTS
    } else if (!fieldContract.requiredForTrusted && field.status === 'estimated') {
      scorePenalty += SECONDARY_ESTIMATED_FIELD_PENALTY_POINTS
    }
  }

  return Math.min(scorePenalty, MAX_FIRST_PAGE_PENALTY_POINTS)
}

const buildSummary = (
  status: FirstPageTrustAssessment['status'],
  prominentIssues: string[]
): string => {
  if (status === 'trusted') {
    return 'First-page numbers are supported by verified or well-supported inputs.'
  }

  if (status === 'unsupported') {
    return prominentIssues.length > 0
      ? `First-page decision metrics rely on weak inputs: ${prominentIssues.join(', ')}.`
      : 'First-page decision metrics rely on weak inputs that need verification.'
  }

  return prominentIssues.length > 0
    ? `First-page decision metrics are usable, but verify ${prominentIssues.join(', ')} before acting on them.`
    : 'First-page decision metrics are usable, but some modeled inputs still need verification.'
}

const buildVerificationMessage = (
  metricLabel: string,
  fieldsToVerify: FirstPageTrustField[]
): string | null => {
  const weakFieldLabels = fieldsToVerify
    .filter((field) => field.status === 'weak')
    .map((field) => field.label.toLowerCase())

  if (weakFieldLabels.length === 0) {
    return null
  }

  return `${metricLabel} hidden until ${weakFieldLabels.join(', ')} ${
    weakFieldLabels.length === 1 ? 'is' : 'are'
  } verified.`
}

export const evaluateFirstPageTrust = (
  input: EvaluateFirstPageTrustInput
): FirstPageTrustAssessment => {
  const reportWarnings = input.reportWarnings ?? []
  const rentWarnings = input.rentWarnings ?? []
  const condoLikeProperty = isCondoLikeProperty(input.propertyType)
  const listingPriceConflictDetected =
    typeof input.primaryListingPrice === 'number' &&
    typeof input.fallbackListingPrice === 'number' &&
    hasMaterialListingPriceConflict(input.primaryListingPrice, input.fallbackListingPrice)
  const staleManualListingPrice =
    Boolean(input.listingPriceUserSupplied) &&
    isListingPriceCheckStale(input.listingPriceCheckedAt, input.referenceTimeMs)
  const propertyFactsMissing =
    !isPresentNumber(input.bedrooms) ||
    !isPresentNumber(input.bathrooms) ||
    !isPresentNumber(input.squareFeet) ||
    !isPresentNumber(input.yearBuilt)

  const factsField =
    propertyFactsMissing ||
    input.dataCompleteness === 'avm-only' ||
    hasWarningCode(reportWarnings, 'property-profile-inferred') ||
    hasWarningCode(reportWarnings, 'property-classification-uncertain') ||
    hasWarningCode(reportWarnings, 'condo-misclassified') ||
    hasWarningCode(reportWarnings, 'bed-bath-ratio-mismatch') ||
    hasWarningCode(reportWarnings, 'bedrooms-implausible') ||
    hasWarningCode(reportWarnings, 'sqft-bedroom-mismatch')
      ? buildField(
          'Property facts',
          'weak',
          'Beds, baths, square footage, or classification are not trustworthy enough to drive a clean decision signal.'
        )
      : buildField(
          'Property facts',
          'verified',
          'Property profile came from a direct record without classification red flags.'
        )

  const listingPriceField =
    input.listingPriceStatus !== 'resolved'
      ? buildField(
          'Listing price',
          'weak',
          'Current ask price is unresolved, so the deal anchor is not trustworthy.'
        )
      : staleManualListingPrice
      ? buildField(
          'Listing price',
          'weak',
          'The manually confirmed ask price is stale and must be reconfirmed before trusting the decision signal.'
        )
      : input.listingPriceSource === 'user-confirmed' && listingPriceConflictDetected
      ? buildField(
          'Listing price',
          'estimated',
          'Current ask price was manually reconciled against conflicting sources, so page-one deal math needs extra caution.'
        )
      : input.listingPriceSource === 'fallback'
      ? buildField(
          'Listing price',
          'supported',
          'Current ask price was recovered from a secondary source.'
        )
      : input.listingPriceSource === 'user-confirmed'
      ? buildField(
          'Listing price',
          'supported',
          'Current ask price was manually confirmed before the report was generated.'
        )
      : buildField(
          'Listing price',
          'verified',
          'Current ask price came from the primary source.'
        )

  const rentField =
    hasWarningCode(reportWarnings, 'rent-comps-wide-spread') ||
    hasWarningCode(reportWarnings, 'rent-avm-below-comps') ||
    rentWarnings.length > 0
      ? buildField(
          'Rent',
          'weak',
          'Rent estimate conflicts with the available rent comps, so cash-flow and 5-year projections are fragile.'
        )
      : condoLikeProperty &&
        (input.sameBuildingRentCompCount ?? 0) < 1 &&
        (input.totalRentCompCount ?? 0) < 3
      ? buildField(
          'Rent',
          'weak',
          'Condo rent estimate is not backed by same-building or sufficient nearby comps, so page-one decision math is not dependable.'
        )
      : (input.sameBuildingRentCompCount ?? 0) >= 2
      ? buildField(
          'Rent',
          'verified',
          'Rent estimate is backed by same-building comps.'
        )
      : (input.totalRentCompCount ?? 0) >= 3
      ? buildField(
          'Rent',
          'supported',
          'Rent estimate is supported by nearby comps, but not by multiple same-building matches.'
        )
      : (input.totalRentCompCount ?? 0) >= 2
      ? buildField(
          'Rent',
          'estimated',
          'Rent estimate has only thin comp support, so page-one rent assumptions need caution.'
        )
      : buildField(
          'Rent',
          'weak',
          'Rent estimate is mostly AVM-driven because the comp support is too thin for a clean first-page decision.'
        )

  const hoaField =
    isHoaSensitiveProperty(input.propertyType) && input.hoaSource === 'not-captured'
      ? buildField(
          'HOA',
          'weak',
          'HOA dues were not captured for a property type that usually depends on them, so expense math on page one is unreliable.'
        )
      : input.hoaSource === 'listing'
      ? buildField(
          'HOA',
          'verified',
          'HOA came from the current listing.'
        )
      : input.hoaSource === 'building-avg'
      ? buildField(
          'HOA',
          'supported',
          'HOA was cross-checked against building-level data.'
        )
      : input.hoaSource === 'inferred-condo-default'
      ? buildField(
          'HOA',
          'weak',
          'HOA is inferred, not captured, so expense math needs verification before trusting page one.'
        )
      : buildField(
          'HOA',
          'verified',
          'No HOA applies to the current property profile.'
        )

  const propertyTaxField =
    input.taxLikelyExempted
      ? buildField(
          'Property tax',
          'weak',
          'County tax record may reflect an owner exemption that resets on sale.'
        )
      : input.propertyTaxSource === 'county-record'
      ? buildField(
          'Property tax',
          'verified',
          'Property tax came from a county record.'
        )
      : input.propertyTaxSource === 'city-override'
      ? buildField(
          'Property tax',
          'supported',
          'Property tax uses a local jurisdiction override instead of a parcel-specific tax record.'
        )
      : buildField(
          'Property tax',
          'estimated',
          'Property tax is estimated from jurisdiction defaults rather than a parcel-specific tax record.'
        )

  const insuranceField =
    hasWarningCode(reportWarnings, 'florida-condo-insurance-diligence') ||
    Boolean(input.climateFloodInsuranceRequired)
      ? buildField(
          'Insurance',
          'weak',
          'Insurance is unusually fragile here and should not be treated as a precise carrying-cost input.'
        )
      : input.insuranceSource === 'climate-model'
      ? buildField(
          'Insurance',
          'supported',
          'Insurance uses the state and climate model rather than a quoted policy.'
        )
      : input.insuranceSource === 'hoa-adjusted-condo' ||
        input.insuranceSource === 'hoa-adjusted-townhouse'
      ? buildField(
          'Insurance',
          'supported',
          'Insurance was adjusted for likely HOA or master-policy coverage, but it is still modeled rather than quoted.'
        )
      : buildField(
          'Insurance',
          'estimated',
          'Insurance is still a modeled estimate, not a quoted policy.'
        )

  const valueField =
    input.valueConfidence === 'high'
      ? buildField(
          'Value',
          'supported',
          'Value signals are tightly aligned.'
        )
      : input.valueConfidence === 'medium'
      ? buildField(
          'Value',
          'estimated',
          'Value signals are usable but not precise.'
        )
      : buildField(
          'Value',
          'weak',
          'Value signals diverge too much to trust a clean headline valuation.'
        )

  const fields: FirstPageTrustFields = {
    facts: factsField,
    hoa: hoaField,
    insurance: insuranceField,
    listingPrice: listingPriceField,
    propertyTax: propertyTaxField,
    rent: rentField,
    value: valueField,
  }
  const fieldContracts = getLaunchTrustContracts()
  const weakUnsupportedFields = fieldContracts.filter((fieldContract) => {
    return fieldContract.unsupportedWhenWeak && fields[fieldContract.fieldKey].status === 'weak'
  })
  const trustedThresholdMisses = fieldContracts.filter((fieldContract) => {
    return (
      fieldContract.requiredForTrusted &&
      !fieldContract.trustedStatuses.includes(fields[fieldContract.fieldKey].status)
    )
  })
  const estimatedCautionFields = fieldContracts.filter((fieldContract) => {
    return fieldContract.cautionWhenEstimated && fields[fieldContract.fieldKey].status === 'estimated'
  })
  const secondaryWeakFields = fieldContracts.filter((fieldContract) => {
    return !fieldContract.unsupportedWhenWeak && fields[fieldContract.fieldKey].status === 'weak'
  })

  const status: FirstPageTrustAssessment['status'] = weakUnsupportedFields.length > 0
    ? 'unsupported'
    : trustedThresholdMisses.length > 0 ||
      estimatedCautionFields.length > 0 ||
      secondaryWeakFields.length > 0
    ? 'caution'
    : 'trusted'

  const scorePenalty = calculatePenalty(fields)
  const adjustedScore = Math.max(0, Math.round(input.rawScore - scorePenalty))

  const prominentIssues = Object.values(fields)
    .filter((field) => field.status === 'weak')
    .map((field) => field.label.toLowerCase())

  const getFieldsForMetric = (metricKey: 'breakevenSignal' | 'forwardProjection') => {
    return getLaunchTrustMetricContract(metricKey).dependencyFieldKeys.map(
      (fieldKey: LaunchTrustFieldKey) => fields[fieldKey]
    )
  }

  const breakevenVerificationFields = getFieldsForMetric('breakevenSignal')
  const projectionVerificationFields = getFieldsForMetric('forwardProjection')

  const suppressBreakevenSignal = status === 'unsupported' || breakevenVerificationFields.some(
    (field) => field.status === 'weak'
  )
  const suppressForwardProjection =
    status === 'unsupported' || projectionVerificationFields.some((field) => field.status === 'weak')

  const breakevenMessage = suppressBreakevenSignal
    ? buildVerificationMessage('Breakeven signal', breakevenVerificationFields)
    : null
  const projectionMessage = suppressForwardProjection
    ? buildVerificationMessage('5-year projection', projectionVerificationFields)
    : null

  const investorSignal: FirstPageTrustAssessment['investorSignal'] =
    adjustedScore >= INVEST_SCORE_THRESHOLD && status === 'trusted'
      ? 'invest'
      : adjustedScore < THINK_SCORE_THRESHOLD ||
        (status === 'unsupported' && input.monthlyNetCashFlow < 0)
      ? 'run'
      : 'think'

  return {
    adjustedScore,
    breakevenMessage,
    investorSignal,
    prominentIssues,
    projectionMessage,
    scorePenalty,
    status,
    summary: buildSummary(status, prominentIssues),
    suppressBreakevenSignal,
    suppressForwardProjection,
    fields,
  }
}
