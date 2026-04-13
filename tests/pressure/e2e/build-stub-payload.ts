#!/usr/bin/env tsx
/**
 * Generates tests/pressure/e2e/stub-payload.json — a pre-composed
 * fullReportData that the Playwright fetch-stubs use to render the UI
 * without needing to call composeFullReport at runtime (Playwright's
 * bundler trips on dynamic ESM imports of lib/ modules).
 *
 * Run once:
 *   npx tsx tests/pressure/e2e/build-stub-payload.ts
 *
 * Re-run after the Austin baseline fixture refreshes or whenever the
 * composeFullReport shape changes.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { composeFullReport } from '../../../lib/reportGenerator'
import { STUB_DEAL_DOCTOR } from '../scenarios/stub-ai'

async function main() {
  const fixturePath = path.resolve(__dirname, '..', 'fixtures', 'austin-baseline.json')
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  const fullReportData = await composeFullReport(
    fixture.reportRow,
    fixture.fetchResults,
    STUB_DEAL_DOCTOR
  )
  const outPath = path.resolve(__dirname, 'stub-payload.json')
  fs.writeFileSync(outPath, JSON.stringify(fullReportData, null, 2))
  console.log(`✓ Wrote ${outPath} (${fs.statSync(outPath).size} bytes)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
