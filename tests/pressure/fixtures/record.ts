#!/usr/bin/env tsx
/**
 * Fixture recorder for DealDoctor pressure tests.
 *
 * Fires real API calls (Rentcast, Mapbox, FEMA, Freddie Mac) for a given
 * address and writes the responses to a JSON fixture file. The scenario
 * tests (tests/pressure/scenarios/*.test.ts) then replay these fixtures
 * through composeFullReport without touching the network.
 *
 * Usage:
 *   npx tsx tests/pressure/fixtures/record.ts \
 *     --slug fort-myers-oasis \
 *     --address "3000 Oasis Grand Blvd, Apt 2502" \
 *     --city "Fort Myers" --state FL --zip 33916 \
 *     --strategy LTR --offer 275000
 *
 * Refresh cadence: quarterly (Apr / Jul / Oct / Jan) or when you suspect
 * an API shape drift. Review diffs before committing.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  searchProperty,
  getRentEstimate,
  getComparableSales,
  getRentComps,
  getMarketSnapshot,
} from '../../../lib/propertyApi'
import { getCurrentRates } from '../../../lib/rates'
import { getClimateAndInsurance } from '../../../lib/climateRisk'
import { getLocationSignals } from '../../../lib/locationSignals'

interface Args {
  slug: string
  address: string
  city: string
  state: string
  zip: string
  strategy: 'LTR' | 'STR' | 'FLIP'
  offer?: number
  downPct?: number
  rehab?: number
}

function parseArgs(): Args {
  const a = process.argv.slice(2)
  const pick = (flag: string) => {
    const i = a.indexOf(flag)
    return i >= 0 ? a[i + 1] : undefined
  }
  const slug = pick('--slug')
  const address = pick('--address')
  const city = pick('--city')
  const state = pick('--state')
  const zip = pick('--zip')
  if (!slug || !address || !city || !state || !zip) {
    console.error(
      'Missing required flags. Required: --slug --address --city --state --zip'
    )
    process.exit(1)
  }
  return {
    slug,
    address,
    city,
    state,
    zip,
    strategy: (pick('--strategy') as 'LTR' | 'STR' | 'FLIP') ?? 'LTR',
    offer: pick('--offer') ? Number(pick('--offer')) : undefined,
    downPct: pick('--down') ? Number(pick('--down')) : 0.25,
    rehab: pick('--rehab') ? Number(pick('--rehab')) : 0,
  }
}

// Serialize a PromiseSettledResult to JSON. Errors lose their stack but we
// keep the message so tests see what a failed fetch looked like.
async function settle<T>(p: Promise<T>) {
  try {
    const value = await p
    return { status: 'fulfilled' as const, value }
  } catch (err: any) {
    return {
      status: 'rejected' as const,
      reason: { name: err?.constructor?.name, message: err?.message ?? String(err) },
    }
  }
}

async function main() {
  const args = parseArgs()
  console.log(`Recording fixture for ${args.address}, ${args.city}, ${args.state}`)

  const property = await searchProperty(args.address)
  if (!property) {
    console.error('Property lookup returned null — cannot build fixture')
    process.exit(2)
  }

  const rates = await getCurrentRates()
  const coords =
    typeof property.latitude === 'number' && typeof property.longitude === 'number'
      ? { lat: property.latitude, lng: property.longitude }
      : null

  const offerPrice = args.offer ?? property.estimated_value

  const [rentEstimate, saleComps, rentComps, marketSnapshot] = await Promise.all([
    settle(getRentEstimate(args.address, property.bedrooms)),
    settle(
      getComparableSales(args.city, args.state, property.bedrooms, coords, 1.0, {
        sqft: property.square_feet,
        value: property.estimated_value,
        propertyType: property.property_type,
      })
    ),
    settle(getRentComps(args.address, property.bedrooms, property.property_type)),
    settle(getMarketSnapshot(args.zip)),
  ])

  const [climate, locationSignals] = await Promise.all([
    settle(getClimateAndInsurance(args.address, args.state, args.zip, offerPrice)),
    settle(coords ? getLocationSignals(coords.lat, coords.lng) : Promise.resolve(null)),
  ])

  // Synthesize the Report row shape that composeFullReport expects.
  // Mirrors Prisma's Report model with the fields we actually read.
  const reportRow = {
    id: `fixture-${args.slug}`,
    address: args.address,
    city: args.city,
    state: args.state,
    zipCode: args.zip,
    strategy: args.strategy,
    offerPrice: args.offer ?? null,
    downPaymentPct: args.downPct ?? null,
    rehabBudget: args.rehab ?? null,
    teaserData: '{}', // non-null so composeFullReport's early-return guard doesn't trip
    paid: false,
    fullReportData: null,
    photoFindings: null,
    customerId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const fixture = {
    recordedAt: new Date().toISOString(),
    args,
    reportRow,
    fetchResults: {
      property,
      rates,
      rentEstimate,
      saleComps,
      rentComps,
      marketSnapshot,
      climate,
      locationSignals,
    },
  }

  const outPath = path.join(__dirname, `${args.slug}.json`)
  fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2))
  console.log(`✓ Wrote ${outPath} (${fs.statSync(outPath).size} bytes)`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
