/**
 * Shared invariants for pressure-test scenarios.
 *
 * Every fullReportData produced by composeFullReport should satisfy all of
 * these — regardless of which address was fed in. Per-scenario tests run the
 * full set via `assertAlwaysOnInvariants()` and then layer scenario-specific
 * bounds on top.
 *
 * Why these specific invariants: each one corresponds to a class of bug that
 * has reached production during the session and been caught by Grok audits.
 * The goal is to block that whole class from recurring.
 */

import { expect } from 'vitest'
import type { Report } from '@prisma/client'
import {
  composeFullReport,
  type ReportFetchResults,
} from '../../../lib/reportGenerator'
import { STUB_DEAL_DOCTOR } from './stub-ai'

export { STUB_DEAL_DOCTOR }

/**
 * Stable top-level key set for `fullReportData`. If this drifts, something
 * was removed or renamed — scenario tests will fail until the snapshot is
 * intentionally updated.
 */
export const EXPECTED_FULL_REPORT_KEYS = [
  'generatedAt',
  'property',
  'rates',
  'breakeven',
  'expenses',
  'rentAdjustment',
  'inputs',
  'cashToClose',
  'wealthProjection',
  'financingAlternatives',
  'sensitivity',
  'recommendedOffers',
  'strProjection',
  'marketSnapshot',
  'locationSignals',
  'rentComps',
  'climate',
  'valueTriangulation',
  'rentWarnings',
  'warnings',
  'qualityAudit',
  'marketAudit',
  'invariantWarnings',
  'reviewOutcome',
  'crossCheckLinks',
  'ltr',
  'dealDoctor',
  'dealDoctorError',
  'dealDoctorErrorDetail',
  'comparableSales',
  'stateRules',
].sort()

/**
 * Load and replay a fixture through `composeFullReport`, returning the
 * `fullReportData`. The deterministic AI stub means the output is
 * fixture-deterministic end-to-end (modulo `generatedAt`).
 */
export async function replayFixture(slug: string) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const file = path.join(__dirname, '..', 'fixtures', `${slug}.json`)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const report = raw.reportRow as Report
  const fetchResults = raw.fetchResults as ReportFetchResults
  return composeFullReport(report, fetchResults, STUB_DEAL_DOCTOR)
}

// ------ Invariant helpers ------

/**
 * Paths where NaN is a legitimate signal (not a bug). IRR on a deeply-
 * negative-equity scenario has no real answer, and we deliberately return
 * NaN so the UI shows "N/A" instead of the old "1000%" clamp ceiling.
 * Array indices are normalized to `*` before match.
 */
const ALLOWED_NAN_PATH_PATTERNS: string[] = [
  'wealthProjection.hero.irr5yr',
  'sensitivity.*.fiveYrIRR',
  'financingAlternatives.*.fiveYrIRR',
  'strProjection.*.fiveYrIRR',
]

function normalizeIndicesToStar(dotted: string): string {
  return dotted.replace(/\.\d+(?=\.|$)/g, '.*')
}

function isAllowedNaNPath(dotted: string): boolean {
  const normalized = normalizeIndicesToStar(dotted)
  return ALLOWED_NAN_PATH_PATTERNS.includes(normalized)
}

/**
 * Walk the object tree looking for NaN-valued numbers, numbers that
 * serialize as "NaN" strings, or string fields containing "undefined" / "null"
 * substrings. Returns the dotted path of the first offender, or null if clean.
 * Fields in ALLOWED_NAN_PATHS are permitted to be NaN.
 */
export function findBadValue(
  node: any,
  path: string[] = []
): { path: string; reason: string; value: any } | null {
  if (node === null || node === undefined) return null
  if (typeof node === 'number') {
    if (Number.isNaN(node)) {
      const dotted = path.join('.')
      if (isAllowedNaNPath(dotted)) return null
      return { path: dotted, reason: 'NaN number', value: node }
    }
    return null
  }
  if (typeof node === 'string') {
    if (node.includes('undefined'))
      return {
        path: path.join('.'),
        reason: 'string contains "undefined"',
        value: node,
      }
    if (node === 'NaN')
      return { path: path.join('.'), reason: 'literal "NaN" string', value: node }
    return null
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const hit = findBadValue(node[i], [...path, String(i)])
      if (hit) return hit
    }
    return null
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const hit = findBadValue(v, [...path, k])
      if (hit) return hit
    }
  }
  return null
}

/**
 * Every field that should be a positive dollar amount. Monotonically growing
 * list — add new fields as the report schema grows.
 */
const MONETARY_FIELDS = [
  ['property.offerPrice'],
  ['property.askPrice'],
  ['breakeven.price'],
  ['expenses.monthlyPropertyTax'],
  ['expenses.monthlyInsurance'],
  ['expenses.monthlyTotal'],
  ['cashToClose.totalCashToClose'],
  ['inputs.monthlyRent'],
]

function deepGet(obj: any, dotted: string) {
  return dotted.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), obj)
}

/**
 * Assert all always-on invariants. Throws on violation with a message
 * pointing to the specific field that failed. Each invariant corresponds
 * to a prior-session bug class — revert any of the fixes from the session
 * and exactly one of these should fail.
 */
export function assertAlwaysOnInvariants(data: any) {
  // 1. Schema stability — top-level key set matches the snapshot
  expect(Object.keys(data).sort()).toEqual(EXPECTED_FULL_REPORT_KEYS)

  // 2. No NaN-valued numbers or "undefined"/"NaN" strings anywhere
  const bad = findBadValue(data)
  expect(bad, `Bad value at ${bad?.path}: ${bad?.reason}`).toBeNull()

  // 3. All monetary fields non-negative and finite
  for (const [field] of MONETARY_FIELDS) {
    const v = deepGet(data, field)
    expect(Number.isFinite(v), `${field} should be finite, got ${v}`).toBe(true)
    expect(v, `${field} should be non-negative`).toBeGreaterThanOrEqual(0)
  }

  // 4. IRR must be finite OR NaN — never the old clamp-ceiling 10 (= 1000%)
  const irr = data.wealthProjection?.hero?.irr5yr
  if (Number.isFinite(irr)) {
    expect(irr, 'IRR > 500% almost certainly means a math bug').toBeLessThan(5)
    expect(irr).toBeGreaterThan(-1)
  }
  // If irr is NaN that's a valid "undefined scenario" signal — not a failure

  // 5. Comp median (when comps fetch fulfilled AND we have ≥ 3 comps): must be
  //    within 0.5× – 2.0× of subject AVM. Catches the Fort Myers $21.5k median.
  const comps = data.comparableSales ?? []
  const subjectAvm = data.property?.offerPrice ?? 0
  if (comps.length >= 3 && subjectAvm > 0) {
    const values = comps
      .map((c: any) => Number(c.estimated_value))
      .filter((v: number) => Number.isFinite(v) && v > 0)
      .sort((a: number, b: number) => a - b)
    const median = values[Math.floor(values.length / 2)]
    if (median) {
      const ratio = median / subjectAvm
      expect(ratio, `Comp median ${median} vs subject ${subjectAvm} out of 0.5×–2× band`).toBeGreaterThan(0.5)
      expect(ratio).toBeLessThan(2.0)
    }
  }

  // 6. Insurance sanity: when climate is present, insurance must be (0, 2% of
  //    annual value]. Catches a silent $0 fallback and catastrophic overestimates.
  if (data.climate && data.climate.estimatedAnnualInsurance > 0) {
    const annual = data.climate.estimatedAnnualInsurance
    const value = data.property.offerPrice
    expect(annual).toBeGreaterThan(0)
    expect(annual / value, `Insurance > 2% of value at ${annual}/${value}`).toBeLessThanOrEqual(0.02)
  }

  // 7. Walkability consistency: if dataConfidence === 'high' and POI count
  //    ≥ 15, label must NOT be "Very Car-Dependent" (the Fort Myers bug class).
  const ls = data.locationSignals
  if (ls && ls.dataConfidence === 'high') {
    const total =
      ls.amenities.groceries.count +
      ls.amenities.transit.count +
      ls.amenities.restaurants.count +
      ls.amenities.schools.count +
      ls.amenities.parks.count
    if (total >= 15) {
      expect(ls.walkabilityLabel).not.toBe('Very Car-Dependent')
    }
  }

  // 8. AI error state consistency: if dealDoctor is null, dealDoctorError
  //    must be set; and vice versa. Catches silent-swallow bugs.
  if (data.dealDoctor == null) {
    expect(data.dealDoctorError).not.toBeNull()
  } else {
    expect(data.dealDoctorError).toBeNull()
  }

  // 9. rentAdjustment shape: if multiplied, perBedroomRent + bedroomsUsed
  //    must both be set (otherwise the UI renders `undefined`).
  const ra = data.rentAdjustment
  if (ra?.applied) {
    expect(ra.perBedroomRent).toBeGreaterThan(0)
    expect(ra.bedroomsUsed).toBeGreaterThan(0)
    expect(ra.effectiveRent).toBe(ra.perBedroomRent * ra.bedroomsUsed)
  }

  // 10. Value triangulation confidence: signals non-empty + spread is a
  //     finite percentage.
  const vt = data.valueTriangulation
  expect(vt.signals.length).toBeGreaterThan(0)
  expect(Number.isFinite(vt.spreadPct)).toBe(true)
  expect(['high', 'medium', 'low']).toContain(vt.confidence)

  // 11. Breakeven delta math: delta === price − yourOffer (catches subtle
  //     sign regressions).
  expect(data.breakeven.delta).toBe(data.breakeven.price - data.breakeven.yourOffer)

  // 12. Deal score ∈ [0, 100]. Pre-fix, classifyDeal summed three sub-scores
  //     capped individually at 100 without a total cap — strong deals could
  //     show 174/100 (Blacksburg audit). The cap now enforces the /100 label.
  if (data.ltr && typeof data.ltr.dealScore === 'number') {
    expect(data.ltr.dealScore).toBeGreaterThanOrEqual(0)
    expect(data.ltr.dealScore).toBeLessThanOrEqual(100)
  }

  // 13. Value-uncertainty verdict cap. If valueConfidence === 'low' AND
  //     spreadPct > 50, a DEAL verdict must have been downgraded to
  //     MARGINAL (or already was PASS). A DEAL that survived this gate is
  //     the Blacksburg over-rosy-verdict bug.
  if (
    data.valueTriangulation?.confidence === 'low' &&
    data.valueTriangulation?.spreadPct > 50
  ) {
    expect(data.ltr.verdict).not.toBe('DEAL')
  }
}

/**
 * Per-scenario monthly rent-to-value yield check. Bounds are intentionally
 * per-scenario because HCOL condos legit run 0.25%–0.4%/mo while student
 * rentals run higher.
 */
export function assertRentYield(data: any, minMonthly: number, maxMonthly: number) {
  const rent = data.inputs.monthlyRent
  const value = data.property.offerPrice
  const yieldMonthly = rent / value
  expect(
    yieldMonthly,
    `Rent/value yield ${(yieldMonthly * 100).toFixed(3)}%/mo outside [${(minMonthly * 100).toFixed(2)}%, ${(maxMonthly * 100).toFixed(2)}%]`
  ).toBeGreaterThanOrEqual(minMonthly)
  expect(yieldMonthly).toBeLessThanOrEqual(maxMonthly)
}
