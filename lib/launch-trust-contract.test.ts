import { describe, expect, it } from 'vitest'
import {
  getLaunchTrustContracts,
  getLaunchTrustFieldContract,
  getLaunchTrustMetricContract,
} from './launch-trust-contract'

describe('launch trust contract', () => {
  it('defines a contract for every first-page field exactly once', () => {
    const fieldContracts = getLaunchTrustContracts()
    const fieldKeys = fieldContracts.map((fieldContract) => fieldContract.fieldKey)
    const uniqueFieldKeys = new Set(fieldKeys)

    expect(fieldContracts).toHaveLength(7)
    expect(uniqueFieldKeys.size).toBe(fieldContracts.length)
  })

  it('makes listing price and property facts hard blockers when weak', () => {
    const listingPriceContract = getLaunchTrustFieldContract('listingPrice')
    const factsContract = getLaunchTrustFieldContract('facts')

    expect(listingPriceContract.unsupportedWhenWeak).toBe(true)
    expect(factsContract.unsupportedWhenWeak).toBe(true)
    expect(listingPriceContract.userConfirmable).toBe(true)
    expect(factsContract.userConfirmable).toBe(false)
  })

  it('tracks the right dependencies for breakeven and forward projection', () => {
    const breakevenContract = getLaunchTrustMetricContract('breakevenSignal')
    const forwardProjectionContract = getLaunchTrustMetricContract('forwardProjection')

    expect(breakevenContract.dependencyFieldKeys).toEqual([
      'listingPrice',
      'facts',
      'rent',
      'hoa',
      'propertyTax',
      'insurance',
    ])
    expect(forwardProjectionContract.dependencyFieldKeys).toEqual([
      'facts',
      'rent',
      'hoa',
      'propertyTax',
    ])
  })
})

