/**
 * Pure-code invariant gate. Runs after all math + clamps are applied, before
 * the narrative call. Catches math-class contradictions that would otherwise
 * ship through Sonnet as a confident-sounding wrong report.
 *
 * Two severities:
 *   - FAIL: a deterministic contradiction. Report should not ship. Throws
 *     InvariantGateError so composeFullReport can bail.
 *   - WARN: suspicious but not contradictory (DSCR outside plausible band,
 *     extreme GRM, etc.). Attached to the report as a visible flag; does
 *     NOT block shipping.
 *
 * This runs ONCE per report (not looped). Zero API cost, executes in under
 * a millisecond.
 */

export interface InvariantFailure {
  code: string
  severity: 'FAIL' | 'WARN'
  message: string
  actual?: string
  expected?: string
}

export class InvariantGateError extends Error {
  readonly failures: InvariantFailure[]
  constructor(failures: InvariantFailure[]) {
    super(
      `Report failed invariant gate (${failures.filter((f) => f.severity === 'FAIL').length} failures): ${failures
        .filter((f) => f.severity === 'FAIL')
        .map((f) => f.code)
        .join(', ')}`
    )
    this.name = 'InvariantGateError'
    this.failures = failures
  }
}

export interface InvariantGateInput {
  summaryIrr?: number | null              // ltr.irr5yr
  sensitivityBaseIrr?: number | null      // sensitivity base-case irr
  summaryCashFlow?: number | null         // ltr.monthlyNetCashFlow
  sensitivityBaseCashFlow?: number | null // sensitivity base-case monthlyCashFlow
  instantCardBreakeven?: number | null    // teaser.breakeven
  fullReportBreakeven?: number | null     // breakeven.price
  canonicalBreakeven?: number | null      // recommendedOffers.breakevenPrice
  wealthYears?: Array<{
    year: number
    cumulativeCashFlow?: number
    cumulativeTaxShield?: number
    equityFromPaydown?: number
    equityFromAppreciation?: number
    totalWealthBuilt?: number
  }>
  dscr?: number | null
  monthlyRent?: number | null
  avm?: number | null
  propertyType?: string | null
  monthlyHOA?: number | null
}

export interface InvariantGateResult {
  ok: boolean
  failures: InvariantFailure[]  // FAIL severity — blocks
  warnings: InvariantFailure[]  // WARN severity — ships as flags
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function runInvariantCheck(input: InvariantGateInput): InvariantGateResult {
  const failures: InvariantFailure[] = []
  const warnings: InvariantFailure[] = []

  // ── FAIL: IRR contradiction between summary and sensitivity base case ──
  if (finite(input.summaryIrr) && finite(input.sensitivityBaseIrr)) {
    const diff = Math.abs(input.summaryIrr - input.sensitivityBaseIrr)
    if (diff > 0.005) {
      // 0.5% absolute tolerance — anything larger is a wiring bug.
      failures.push({
        code: 'irr-contradiction',
        severity: 'FAIL',
        message: `Summary IRR and sensitivity base-case IRR must match — they share the same inputs`,
        actual: `summary ${(input.summaryIrr * 100).toFixed(2)}% vs sensitivity ${(input.sensitivityBaseIrr * 100).toFixed(2)}%`,
        expected: 'equal within ±0.5%',
      })
    }
  }

  // ── FAIL: cash flow contradiction ──
  if (finite(input.summaryCashFlow) && finite(input.sensitivityBaseCashFlow)) {
    const diff = Math.abs(input.summaryCashFlow - input.sensitivityBaseCashFlow)
    if (diff > 2) {
      failures.push({
        code: 'cashflow-contradiction',
        severity: 'FAIL',
        message: `Summary monthly cash flow and sensitivity base-case monthly cash flow must match`,
        actual: `summary $${input.summaryCashFlow} vs sensitivity $${input.sensitivityBaseCashFlow}`,
        expected: 'equal within $2',
      })
    }
  }

  // ── FAIL: breakeven contradictions across views ──
  if (finite(input.canonicalBreakeven) && finite(input.fullReportBreakeven)) {
    const diff = Math.abs(input.canonicalBreakeven - input.fullReportBreakeven)
    if (diff > 100) {
      failures.push({
        code: 'breakeven-full-report-mismatch',
        severity: 'FAIL',
        message: `Canonical breakeven and full-report breakeven must match (single source of truth)`,
        actual: `canonical $${input.canonicalBreakeven.toLocaleString()} vs fullReport $${input.fullReportBreakeven.toLocaleString()}`,
        expected: 'equal within $100',
      })
    }
  }
  if (finite(input.instantCardBreakeven) && finite(input.canonicalBreakeven)) {
    const diff = Math.abs(input.instantCardBreakeven - input.canonicalBreakeven)
    if (diff > 100) {
      failures.push({
        code: 'breakeven-teaser-mismatch',
        severity: 'FAIL',
        message: `Teaser breakeven and canonical breakeven must match (single source of truth)`,
        actual: `teaser $${input.instantCardBreakeven.toLocaleString()} vs canonical $${input.canonicalBreakeven.toLocaleString()}`,
        expected: 'equal within $100',
      })
    }
  }

  // ── FAIL: wealth table math ──
  const years = input.wealthYears ?? []
  for (const y of years) {
    const parts =
      (y.cumulativeCashFlow ?? 0) +
      (y.cumulativeTaxShield ?? 0) +
      (y.equityFromPaydown ?? 0) +
      (y.equityFromAppreciation ?? 0)
    const total = y.totalWealthBuilt
    if (finite(total) && Math.abs(total - parts) > 100) {
      failures.push({
        code: `wealth-math-y${y.year}`,
        severity: 'FAIL',
        message: `Year-${y.year} wealth does not equal CF + TaxShield + Principal + Appreciation`,
        actual: `$${total.toLocaleString()}`,
        expected: `$${Math.round(parts).toLocaleString()} (sum of components)`,
      })
    }
    if (finite(y.equityFromPaydown) && y.equityFromPaydown < 0) {
      failures.push({
        code: `equity-paydown-negative-y${y.year}`,
        severity: 'FAIL',
        message: `Year-${y.year} principal paydown is negative — principal paydown is always ≥ 0`,
        actual: `$${y.equityFromPaydown}`,
        expected: '≥ 0',
      })
    }
  }

  // ── WARN: DSCR outside plausible band ──
  if (finite(input.dscr)) {
    if (input.dscr < 0.4 || input.dscr > 3.0) {
      warnings.push({
        code: 'dscr-implausible',
        severity: 'WARN',
        message: `DSCR is outside the plausible 0.4–3.0 band — likely a math-units mismatch or wrong loan input`,
        actual: input.dscr.toFixed(2),
        expected: '0.4 ≤ DSCR ≤ 3.0',
      })
    }
  }

  // ── WARN: gross rent multiplier outside plausible band ──
  if (finite(input.avm) && finite(input.monthlyRent) && input.monthlyRent > 0) {
    const grm = input.avm / (input.monthlyRent * 12)
    if (grm < 4 || grm > 40) {
      warnings.push({
        code: 'grm-implausible',
        severity: 'WARN',
        message: `Gross rent multiplier (price / annual rent) is outside the 4–40 plausible band`,
        actual: `GRM ${grm.toFixed(1)} (AVM $${input.avm.toLocaleString()} / annual rent $${(input.monthlyRent * 12).toLocaleString()})`,
        expected: '4 ≤ GRM ≤ 40',
      })
    }
  }

  // ── WARN: HOA missing on condo property type ──
  if (finite(input.monthlyHOA) && input.monthlyHOA === 0 && input.propertyType) {
    const pt = input.propertyType.toLowerCase()
    if (/condo|apartment|co-?op|coop/.test(pt)) {
      warnings.push({
        code: 'hoa-zero-on-condo',
        severity: 'WARN',
        message: `HOA is $0/mo on a ${input.propertyType} — condos essentially always carry HOA`,
        actual: '$0/mo',
        expected: '> $0',
      })
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
  }
}
