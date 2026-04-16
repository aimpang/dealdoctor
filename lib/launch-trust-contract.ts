export type LaunchTrustFieldKey =
  | 'facts'
  | 'listingPrice'
  | 'rent'
  | 'hoa'
  | 'propertyTax'
  | 'insurance'
  | 'value'

export type LaunchTrustFieldStatus = 'verified' | 'supported' | 'estimated' | 'weak'

export type LaunchTrustMetricKey = 'breakevenSignal' | 'forwardProjection'

export interface LaunchTrustFieldContract {
  fieldKey: LaunchTrustFieldKey
  label: string
  requiredForTrusted: boolean
  unsupportedWhenWeak: boolean
  cautionWhenEstimated: boolean
  suppressBreakevenWhenWeak: boolean
  suppressForwardProjectionWhenWeak: boolean
  trustedStatuses: readonly LaunchTrustFieldStatus[]
  userConfirmable: boolean
}

export interface LaunchTrustMetricContract {
  dependencyFieldKeys: readonly LaunchTrustFieldKey[]
  metricKey: LaunchTrustMetricKey
}

const LAUNCH_TRUST_FIELD_CONTRACTS: readonly LaunchTrustFieldContract[] = [
  {
    fieldKey: 'facts',
    label: 'Property facts',
    requiredForTrusted: true,
    unsupportedWhenWeak: true,
    cautionWhenEstimated: true,
    suppressBreakevenWhenWeak: true,
    suppressForwardProjectionWhenWeak: true,
    trustedStatuses: ['verified'],
    userConfirmable: false,
  },
  {
    fieldKey: 'listingPrice',
    label: 'Listing price',
    requiredForTrusted: true,
    unsupportedWhenWeak: true,
    cautionWhenEstimated: true,
    suppressBreakevenWhenWeak: true,
    suppressForwardProjectionWhenWeak: false,
    trustedStatuses: ['verified'],
    userConfirmable: true,
  },
  {
    fieldKey: 'rent',
    label: 'Rent',
    requiredForTrusted: true,
    unsupportedWhenWeak: true,
    cautionWhenEstimated: true,
    suppressBreakevenWhenWeak: true,
    suppressForwardProjectionWhenWeak: true,
    trustedStatuses: ['verified', 'supported'],
    userConfirmable: false,
  },
  {
    fieldKey: 'hoa',
    label: 'HOA',
    requiredForTrusted: true,
    unsupportedWhenWeak: true,
    cautionWhenEstimated: true,
    suppressBreakevenWhenWeak: true,
    suppressForwardProjectionWhenWeak: true,
    trustedStatuses: ['verified'],
    userConfirmable: false,
  },
  {
    fieldKey: 'propertyTax',
    label: 'Property tax',
    requiredForTrusted: true,
    unsupportedWhenWeak: false,
    cautionWhenEstimated: true,
    suppressBreakevenWhenWeak: true,
    suppressForwardProjectionWhenWeak: true,
    trustedStatuses: ['verified', 'supported'],
    userConfirmable: false,
  },
  {
    fieldKey: 'insurance',
    label: 'Insurance',
    requiredForTrusted: false,
    unsupportedWhenWeak: false,
    cautionWhenEstimated: true,
    suppressBreakevenWhenWeak: true,
    suppressForwardProjectionWhenWeak: false,
    trustedStatuses: ['verified', 'supported'],
    userConfirmable: false,
  },
  {
    fieldKey: 'value',
    label: 'Value',
    requiredForTrusted: false,
    unsupportedWhenWeak: false,
    cautionWhenEstimated: true,
    suppressBreakevenWhenWeak: false,
    suppressForwardProjectionWhenWeak: false,
    trustedStatuses: ['verified', 'supported'],
    userConfirmable: false,
  },
]

const LAUNCH_TRUST_METRIC_CONTRACTS: readonly LaunchTrustMetricContract[] = [
  {
    metricKey: 'breakevenSignal',
    dependencyFieldKeys: ['listingPrice', 'facts', 'rent', 'hoa', 'propertyTax', 'insurance'],
  },
  {
    metricKey: 'forwardProjection',
    dependencyFieldKeys: ['facts', 'rent', 'hoa', 'propertyTax'],
  },
]

export const getLaunchTrustContracts = (): readonly LaunchTrustFieldContract[] => {
  return LAUNCH_TRUST_FIELD_CONTRACTS
}

export const getLaunchTrustFieldContract = (
  fieldKey: LaunchTrustFieldKey
): LaunchTrustFieldContract => {
  const matchingFieldContract = LAUNCH_TRUST_FIELD_CONTRACTS.find(
    (fieldContract) => fieldContract.fieldKey === fieldKey
  )

  if (!matchingFieldContract) {
    throw new Error(`Missing launch trust contract for field: ${fieldKey}`)
  }

  return matchingFieldContract
}

export const getLaunchTrustMetricContract = (
  metricKey: LaunchTrustMetricKey
): LaunchTrustMetricContract => {
  const matchingMetricContract = LAUNCH_TRUST_METRIC_CONTRACTS.find(
    (metricContract) => metricContract.metricKey === metricKey
  )

  if (!matchingMetricContract) {
    throw new Error(`Missing launch trust metric contract for metric: ${metricKey}`)
  }

  return matchingMetricContract
}

