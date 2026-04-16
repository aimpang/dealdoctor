import type { Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Route interceptors for the DealDoctor E2E golden path. The real app makes
 * three critical server calls during a report lifecycle:
 *   1. POST /api/preview — creates the Report row, returns UUID + teaser
 *   2. GET  /api/report/[uuid] — polled until fullReportData appears
 *   3. GET  /api/report/[uuid]/export — Excel download
 *
 * We stub all three with responses built from `stub-payload.json`, which is
 * pre-generated via `npx tsx tests/pressure/e2e/build-stub-payload.ts`. This
 * keeps Playwright away from dynamic ESM imports of lib/ modules (its
 * bundler doesn't resolve those reliably).
 */

const STUB_PAYLOAD_PATH = path.resolve(__dirname, 'stub-payload.json')

export const STUB_UUID = '00000000-0000-4000-8000-000000000001'

interface StubOptions {
  /** If provided, /api/report/[uuid] returns this as fullReportData */
  fullReportOverride?: any
  /** UUID returned by the stub — defaults to a fixed string for test stability */
  stubUuid?: string
}

export async function installStubs(page: Page, opts: StubOptions = {}) {
  const stubUuid = opts.stubUuid ?? STUB_UUID

  if (!fs.existsSync(STUB_PAYLOAD_PATH)) {
    throw new Error(
      `Missing ${STUB_PAYLOAD_PATH} — run: npx tsx tests/pressure/e2e/build-stub-payload.ts`
    )
  }
  const fullReportData =
    opts.fullReportOverride ?? JSON.parse(fs.readFileSync(STUB_PAYLOAD_PATH, 'utf8'))

  // 1. Stub POST /api/preview — returns the fake UUID, teaser, and property
  await page.route('**/api/preview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        uuid: stubUuid,
        teaser: {
          estimatedValue: fullReportData.property.offerPrice,
          listingPrice: fullReportData.property.askPrice,
          listingPriceSource: 'primary',
          listingPriceStatus: 'resolved',
          listingPriceCheckedAt: new Date().toISOString(),
          listingPriceUserSupplied: false,
          estimatedRent: fullReportData.inputs.monthlyRent,
          breakevenPrice: fullReportData.breakeven.price,
          listingVsBreakeven: fullReportData.breakeven.delta,
          city: fullReportData.property.city,
          state: fullReportData.property.state,
          bedrooms: fullReportData.property.bedrooms,
          bathrooms: fullReportData.property.bathrooms,
          sqft: fullReportData.property.sqft,
          yearBuilt: fullReportData.property.yearBuilt,
          currentRate: fullReportData.rates.mortgage30yrInvestor,
          pmmsRate: fullReportData.rates.mortgage30yr,
          valueSource: fullReportData.valueTriangulation.valueSource,
          valueRangeLow: fullReportData.valueTriangulation.valueRangeLow,
          valueRangeHigh: fullReportData.valueTriangulation.valueRangeHigh,
        },
        // The landing page consumes `result.property.{city,state,address}` to
        // render the 3D map pin — mirror the production response shape.
        property: {
          address: fullReportData.property.address,
          city: fullReportData.property.city,
          state: fullReportData.property.state,
          type: fullReportData.property.propertyType,
          bedrooms: fullReportData.property.bedrooms,
          bathrooms: fullReportData.property.bathrooms,
        },
        autopaid: null,
      }),
    })
  })

  // 2. Stub GET /api/report/[uuid] — returns paid + full report payload
  await page.route(`**/api/report/${stubUuid}*`, async (route) => {
    // Ignore sub-routes (export, retry-ai) — those return 405 if called
    const url = route.request().url()
    if (url.includes('/export') || url.includes('/retry-ai') || url.includes('/feedback')) {
      await route.fulfill({ status: 405, body: 'method not allowed in stub' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: stubUuid,
        address: fullReportData.property.address,
        city: fullReportData.property.city,
        state: fullReportData.property.state,
        paid: true,
        debug: true,
        teaserData: null,
        fullReportData: JSON.stringify(fullReportData),
        photoFindings: null,
        addressFlags: { total: 0, ok: 0, value_off: 0, rent_off: 0 },
        createdAt: new Date().toISOString(),
      }),
    })
  })

  // 3. Stub /api/stats (landing page LiveCounter calls this)
  await page.route('**/api/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ totalReports: 1337, paidReports: 200, reportsThisWeek: 42 }),
    })
  })
}
