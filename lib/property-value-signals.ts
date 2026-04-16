interface PropertyValueResolutionInput {
  listingPrice?: number | null
  avmPrice?: number | null
  avmLow?: number | null
  avmHigh?: number | null
  taxAssessmentValues?: Array<number | null | undefined>
  lastSalePrice?: number | null
  lastSaleDate?: string | null
  currentDate?: Date
}

interface PropertyValueResolutionOutput {
  estimatedValue: number
  listingPrice?: number
  valueSource: 'avm' | 'listing' | 'tax-assessment' | 'last-sale-grown' | 'unknown'
  valueRangeLow?: number
  valueRangeHigh?: number
}

interface ListingPriceCandidate {
  listing_price?: number
  estimated_value: number
}

const TAX_ASSESSMENT_MARKET_MULTIPLIER = 1.15
const DEFAULT_LAST_SALE_GROWTH_RATE = 0.03

const toPositiveNumber = (value: unknown): number | undefined => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : undefined
}

export const resolvePropertyValueSignals = (
  input: PropertyValueResolutionInput
): PropertyValueResolutionOutput => {
  const listingPrice = toPositiveNumber(input.listingPrice)
  const avmPrice = toPositiveNumber(input.avmPrice)
  const avmLow = toPositiveNumber(input.avmLow)
  const avmHigh = toPositiveNumber(input.avmHigh)

  if (avmPrice) {
    return {
      estimatedValue: avmPrice,
      listingPrice,
      valueSource: 'avm',
      valueRangeLow: avmLow,
      valueRangeHigh: avmHigh,
    }
  }

  if (listingPrice) {
    return {
      estimatedValue: listingPrice,
      listingPrice,
      valueSource: 'listing',
    }
  }

  for (const taxAssessmentValue of input.taxAssessmentValues ?? []) {
    const positiveAssessmentValue = toPositiveNumber(taxAssessmentValue)
    if (positiveAssessmentValue) {
      return {
        estimatedValue: Math.round(
          positiveAssessmentValue * TAX_ASSESSMENT_MARKET_MULTIPLIER
        ),
        listingPrice,
        valueSource: 'tax-assessment',
      }
    }
  }

  const lastSalePrice = toPositiveNumber(input.lastSalePrice)
  if (lastSalePrice && input.lastSaleDate) {
    const saleYear = new Date(input.lastSaleDate).getFullYear()
    const currentYear = (input.currentDate ?? new Date()).getFullYear()
    const yearsSinceSale = Math.max(0, currentYear - saleYear)
    return {
      estimatedValue: Math.round(
        lastSalePrice * Math.pow(1 + DEFAULT_LAST_SALE_GROWTH_RATE, yearsSinceSale)
      ),
      listingPrice,
      valueSource: 'last-sale-grown',
    }
  }

  return {
    estimatedValue: 0,
    listingPrice,
    valueSource: 'unknown',
  }
}

export const resolveListingPrice = (property: ListingPriceCandidate): number => {
  const listingPrice = toPositiveNumber(property.listing_price)
  return listingPrice ?? property.estimated_value
}
