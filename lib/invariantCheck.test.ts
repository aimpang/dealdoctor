import { describe, it, expect } from 'vitest'
import { runInvariantCheck, InvariantGateError } from './invariantCheck'

// Helper — minimal input that passes the gate. Individual tests override
// only the field(s) they're exercising so each rule is isolated from
// unrelated invariants.
function passing(): Parameters<typeof runInvariantCheck>[0] {
  return {
    summaryIrr: 0.08,
    sensitivityBaseIrr: 0.08,
    summaryCashFlow: 200,
    sensitivityBaseCashFlow: 200,
    instantCardBreakeven: 250_000,
    fullReportBreakeven: 250_000,
    canonicalBreakeven: 250_000,
    wealthYears: [
      {
        year: 5,
        cumulativeCashFlow: 10_000,
        cumulativeTaxShield: 5_000,
        equityFromPaydown: 20_000,
        equityFromAppreciation: 50_000,
        totalWealthBuilt: 85_000,
      },
    ],
    dscr: 1.3,
    monthlyRent: 2_000,
    avm: 300_000,
    propertyType: 'Single Family',
    monthlyHOA: 0,
    dealScore: 65,
  }
}

describe('runInvariantCheck', () => {
  it('passes the happy path (no failures, no warnings)', () => {
    const res = runInvariantCheck(passing())
    expect(res.ok).toBe(true)
    expect(res.failures).toHaveLength(0)
    expect(res.warnings).toHaveLength(0)
  })

  it('FAILs on IRR contradiction between summary and sensitivity', () => {
    const input = passing()
    input.summaryIrr = 0.12
    input.sensitivityBaseIrr = 0.08 // 4pp gap, well past 0.5% tolerance
    const res = runInvariantCheck(input)
    expect(res.ok).toBe(false)
    expect(res.failures.map((f) => f.code)).toContain('irr-contradiction')
  })

  it('FAILs on cash-flow contradiction', () => {
    const input = passing()
    input.summaryCashFlow = 500
    input.sensitivityBaseCashFlow = 100
    const res = runInvariantCheck(input)
    expect(res.failures.map((f) => f.code)).toContain('cashflow-contradiction')
  })

  it('FAILs on wealth-component math mismatch', () => {
    const input = passing()
    // totalWealthBuilt says 85_000 but components sum to 85_000 in passing();
    // knock it out of sync by $500
    input.wealthYears = [{ ...input.wealthYears![0], totalWealthBuilt: 84_500 }]
    const res = runInvariantCheck(input)
    expect(res.failures.map((f) => f.code)).toContain('wealth-math-y5')
  })

  it('FAILs on negative equity-from-paydown', () => {
    const input = passing()
    input.wealthYears = [
      {
        ...input.wealthYears![0],
        equityFromPaydown: -1_000,
        totalWealthBuilt:
          (input.wealthYears![0].cumulativeCashFlow ?? 0) +
          (input.wealthYears![0].cumulativeTaxShield ?? 0) +
          -1_000 +
          (input.wealthYears![0].equityFromAppreciation ?? 0),
      },
    ]
    const res = runInvariantCheck(input)
    expect(res.failures.map((f) => f.code)).toContain('equity-paydown-negative-y5')
  })

  // The invariant gate exists to catch *math/units bugs*, not bad deals.
  // A genuinely terrible underwrite (high HOA, low rent) can produce a
  // DSCR of 0.05–0.20 with arithmetically perfect math — that's signal,
  // not noise. The only DSCR values that reliably indicate a bug are
  // wildly high ones (e.g. annual NOI accidentally divided by monthly
  // debt service inflates DSCR ~12×). Band: warn only when DSCR > 10.
  it('WARNs on impossibly-high DSCR (likely a units-mismatch bug)', () => {
    const input = passing()
    input.dscr = 12 // monthly NOI / monthly debt accidentally annualized
    const res = runInvariantCheck(input)
    expect(res.ok).toBe(true) // WARN does not block
    expect(res.warnings.map((w) => w.code)).toContain('dscr-implausible')
  })

  describe('DSCR warning band', () => {
    it('does NOT warn on a low-but-consistent DSCR (genuinely bad deal)', () => {
      // Real Fort Myers FL condo case: NOI=$1,536/yr, debt=$19,068/yr →
      // DSCR=0.08. Math is exact; the deal is just bad. Should not warn.
      const input = passing()
      input.dscr = 0.08
      const res = runInvariantCheck(input)
      expect(res.warnings.map((w) => w.code)).not.toContain('dscr-implausible')
    })

    it('does NOT warn at the upper boundary (10.0)', () => {
      const input = passing()
      input.dscr = 10
      const res = runInvariantCheck(input)
      expect(res.warnings.map((w) => w.code)).not.toContain('dscr-implausible')
    })

    it('warns just above the upper boundary (10.01)', () => {
      const input = passing()
      input.dscr = 10.01
      const res = runInvariantCheck(input)
      expect(res.ok).toBe(true)
      expect(res.warnings.map((w) => w.code)).toContain('dscr-implausible')
    })

    it('does NOT warn on negative DSCR (negative NOI is a real outcome)', () => {
      // Effective rent < expenses → NOI < 0 → DSCR < 0. Real bad deal,
      // not a math bug. Caller already shows it via FAIL verdict + CF sign.
      const input = passing()
      input.dscr = -0.5
      const res = runInvariantCheck(input)
      expect(res.warnings.map((w) => w.code)).not.toContain('dscr-implausible')
    })
  })

  it('WARNs on HOA = $0 for a condo property type', () => {
    const input = passing()
    input.propertyType = 'Condo'
    input.monthlyHOA = 0
    const res = runInvariantCheck(input)
    expect(res.ok).toBe(true)
    expect(res.warnings.map((w) => w.code)).toContain('hoa-zero-on-condo')
  })

  // ── dealScore vs wealth contradiction (batch pressure test) ──────────
  describe('deal-score-wealth-contradiction', () => {
    it('FAILs when dealScore is 0 but final-year wealth is positive', () => {
      const input = passing()
      input.dealScore = 0 // classifier rejects
      // wealth stays positive from the passing fixture ($85k)
      const res = runInvariantCheck(input)
      expect(res.ok).toBe(false)
      expect(res.failures.map((f) => f.code)).toContain('deal-score-wealth-contradiction')
    })

    it('PASSes when dealScore is 0 AND final-year wealth is non-positive (consistent rejection)', () => {
      const input = passing()
      input.dealScore = 0
      input.wealthYears = [
        {
          year: 5,
          cumulativeCashFlow: -30_000,
          cumulativeTaxShield: 5_000,
          equityFromPaydown: 10_000,
          equityFromAppreciation: 0,
          totalWealthBuilt: -15_000,
        },
      ]
      const res = runInvariantCheck(input)
      expect(res.failures.map((f) => f.code)).not.toContain('deal-score-wealth-contradiction')
    })

    it('PASSes when dealScore > 0, regardless of wealth sign', () => {
      const input = passing()
      input.dealScore = 1 // classifier accepts (barely)
      const res = runInvariantCheck(input)
      expect(res.failures.map((f) => f.code)).not.toContain('deal-score-wealth-contradiction')
    })

    it('does not fire when dealScore is null/undefined (field unused)', () => {
      const input = passing()
      delete (input as { dealScore?: unknown }).dealScore
      const res = runInvariantCheck(input)
      expect(res.failures.map((f) => f.code)).not.toContain('deal-score-wealth-contradiction')
    })
  })
})

describe('InvariantGateError', () => {
  it('stores failures and produces a readable message', () => {
    const err = new InvariantGateError([
      {
        code: 'deal-score-wealth-contradiction',
        severity: 'FAIL',
        message: 'test',
      },
    ])
    expect(err.name).toBe('InvariantGateError')
    expect(err.failures).toHaveLength(1)
    expect(err.message).toContain('deal-score-wealth-contradiction')
  })
})
