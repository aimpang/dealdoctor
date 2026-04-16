import { describe, it, expect } from 'vitest'
import {
  buildReportWarnings,
  buildSameBuildingRentCompWarning,
  buildValueTriangulationOutput,
  deriveValueConfidence,
  dedupeNearDuplicateComps,
  resolveCanonicalBreakeven,
  resolvePropertyTax,
  selectCompsForArv,
} from './reportGenerator'
import * as reportGenerator from './reportGenerator'

// buildReportWarnings regression suite.
//
// Each class below was a silent failure mode uncovered in the 10-address
// pressure audit (2026-04-13). These tests lock in that:
//   - multi-unit duplex/triplex surfaces a warning in the FULL report
//     (previously only in the teaser preview route),
//   - manufactured / mobile homes are flagged for depreciation/appreciation
//     misfit,
//   - condo-style units with no HOA captured get a data-gap warning,
//   - reports for states not in STATE_RULES surface the TX fallback caveat
//     instead of quietly misreporting property tax by 2-3×.
describe('buildReportWarnings', () => {
  const base = {
    propertyType: 'Single Family',
    monthlyHOA: 0,
    stateRulesMissing: false,
    state: 'TX',
  }

  it('produces no warnings for a clean SFR in a covered state', () => {
    expect(buildReportWarnings(base)).toEqual([])
  })

  describe('multi-unit detection', () => {
    it('flags duplex', () => {
      const w = buildReportWarnings({ ...base, propertyType: 'Duplex' })
      expect(w.map(x => x.code)).toContain('multi-unit-property')
    })
    it('flags triplex', () => {
      const w = buildReportWarnings({ ...base, propertyType: 'Triplex' })
      expect(w.map(x => x.code)).toContain('multi-unit-property')
    })
    it('flags Rentcast "Multi-Family" (hyphen form)', () => {
      const w = buildReportWarnings({ ...base, propertyType: 'Multi-Family' })
      expect(w.map(x => x.code)).toContain('multi-unit-property')
    })
    it('flags "Multi Family" (space form)', () => {
      const w = buildReportWarnings({ ...base, propertyType: 'Multi Family' })
      expect(w.map(x => x.code)).toContain('multi-unit-property')
    })
    it('does not flag standalone SFR', () => {
      const w = buildReportWarnings({ ...base, propertyType: 'Single Family' })
      expect(w.map(x => x.code)).not.toContain('multi-unit-property')
    })
  })

  describe('manufactured / mobile-home detection', () => {
    it('flags "Manufactured"', () => {
      const w = buildReportWarnings({ ...base, propertyType: 'Manufactured' })
      expect(w.map(x => x.code)).toContain('manufactured-home')
    })
    it('flags "Mobile Home"', () => {
      const w = buildReportWarnings({ ...base, propertyType: 'Mobile Home' })
      expect(w.map(x => x.code)).toContain('manufactured-home')
    })
    it('does not flag SFR or condo', () => {
      expect(
        buildReportWarnings({ ...base, propertyType: 'Single Family' }).map(x => x.code)
      ).not.toContain('manufactured-home')
      expect(
        buildReportWarnings({ ...base, propertyType: 'Condo', monthlyHOA: 500 }).map(x => x.code)
      ).not.toContain('manufactured-home')
    })
  })

  describe('condo with no HOA captured', () => {
    it('flags condo with $0 HOA', () => {
      const w = buildReportWarnings({ ...base, propertyType: 'Condo', monthlyHOA: 0 })
      expect(w.map(x => x.code)).toContain('condo-no-hoa-captured')
    })
    it('flags apartment with $0 HOA', () => {
      const w = buildReportWarnings({ ...base, propertyType: 'Apartment', monthlyHOA: 0 })
      expect(w.map(x => x.code)).toContain('condo-no-hoa-captured')
    })
    it('does NOT flag condo when HOA is present', () => {
      const w = buildReportWarnings({ ...base, propertyType: 'Condo', monthlyHOA: 420 })
      expect(w.map(x => x.code)).not.toContain('condo-no-hoa-captured')
    })
    it('does NOT flag SFR with $0 HOA (normal case)', () => {
      const w = buildReportWarnings({ ...base, propertyType: 'Single Family', monthlyHOA: 0 })
      expect(w.map(x => x.code)).not.toContain('condo-no-hoa-captured')
    })
  })

  describe('missing-state fallback', () => {
    it('flags when stateRulesMissing is true', () => {
      const w = buildReportWarnings({ ...base, stateRulesMissing: true, state: 'NM' })
      const hit = w.find(x => x.code === 'state-rules-fallback')
      expect(hit).toBeDefined()
      expect(hit!.message).toContain('NM')
    })
    it('does not flag when state is covered', () => {
      const w = buildReportWarnings({ ...base, stateRulesMissing: false, state: 'TX' })
      expect(w.map(x => x.code)).not.toContain('state-rules-fallback')
    })
  })

  describe('multi-class interactions', () => {
    it('stacks multi-unit + manufactured warnings when both apply', () => {
      // Rare but possible: a manufactured duplex.
      const w = buildReportWarnings({ ...base, propertyType: 'Manufactured Duplex' })
      const codes = w.map(x => x.code)
      expect(codes).toContain('multi-unit-property')
      expect(codes).toContain('manufactured-home')
    })
    it('stacks condo-no-HOA + missing-state', () => {
      const w = buildReportWarnings({
        propertyType: 'Condo',
        monthlyHOA: 0,
        stateRulesMissing: true,
        state: 'NM',
      })
      const codes = w.map(x => x.code)
      expect(codes).toContain('condo-no-hoa-captured')
      expect(codes).toContain('state-rules-fallback')
    })
  })

  describe('defensive / edge cases', () => {
    it('handles null propertyType', () => {
      const w = buildReportWarnings({ ...base, propertyType: null })
      expect(w).toEqual([])
    })
    it('handles undefined propertyType', () => {
      const w = buildReportWarnings({ ...base, propertyType: undefined })
      expect(w).toEqual([])
    })
    it('is case-insensitive for property type matching', () => {
      expect(
        buildReportWarnings({ ...base, propertyType: 'DUPLEX' }).map(x => x.code)
      ).toContain('multi-unit-property')
      expect(
        buildReportWarnings({ ...base, propertyType: 'manufactured' }).map(x => x.code)
      ).toContain('manufactured-home')
    })
  })

  // Bug 2 regression — Old Westbury 3bd/6.5ba estate triggered no warning.
  describe('bed/bath ratio sanity', () => {
    it('flags 3bd / 6.5ba (Old Westbury case)', () => {
      const w = buildReportWarnings({ ...base, bedrooms: 3, bathrooms: 6.5 })
      const hit = w.find((x) => x.code === 'bed-bath-ratio-mismatch')
      expect(hit).toBeDefined()
      expect(hit!.message).toContain('(3)')
      expect(hit!.message).toContain('(6.5)')
    })

    it('does not flag normal 3bd / 2.5ba', () => {
      const w = buildReportWarnings({ ...base, bedrooms: 3, bathrooms: 2.5 })
      expect(w.map((x) => x.code)).not.toContain('bed-bath-ratio-mismatch')
    })

    it('does not flag when ratio is exactly 1.5 (boundary)', () => {
      const w = buildReportWarnings({ ...base, bedrooms: 4, bathrooms: 6 })
      expect(w.map((x) => x.code)).not.toContain('bed-bath-ratio-mismatch')
    })

    it('flags ratio > 1.5', () => {
      const w = buildReportWarnings({ ...base, bedrooms: 4, bathrooms: 7 })
      expect(w.map((x) => x.code)).toContain('bed-bath-ratio-mismatch')
    })

    it('ignores missing bedrooms/bathrooms (no crash)', () => {
      expect(buildReportWarnings({ ...base, bedrooms: undefined, bathrooms: 6 })).toEqual([])
      expect(buildReportWarnings({ ...base, bedrooms: 3, bathrooms: undefined })).toEqual([])
      expect(buildReportWarnings({ ...base, bedrooms: 0, bathrooms: 2 })).toEqual([])
    })
  })

  // Fix 7 — dedupe near-duplicate comps. Three units in the same condo
  // complex (Heights Ln Blacksburg) at $240/$241/$242k should count as 1
  // data point for the comp median, not 3, so one complex doesn't anchor
  // the whole analysis.
  // (Tests are at the top-level `describe` block because the helper is
  // unrelated to buildReportWarnings.)

  // The Apolline regression — a condo subject returned 4 comps from a
  // building 0.7 mi away, not from the subject's own building. When the
  // subject has a parseable building key but NONE of the comps share it,
  // warn the user so they don't trust the median blindly.
  describe('comps-cross-building', () => {
    it('fires when subject has a building key but 0 same-building comps', () => {
      const w = buildReportWarnings({
        ...base,
        subjectHasBuildingKey: true,
        sameBuildingCompCount: 0,
        totalCompCount: 4,
      })
      const hit = w.find((x) => x.code === 'comps-cross-building')
      expect(hit).toBeDefined()
      expect(hit!.message).toContain('4 sale comps')
    })

    it('does NOT fire when at least one comp is same-building', () => {
      const w = buildReportWarnings({
        ...base,
        subjectHasBuildingKey: true,
        sameBuildingCompCount: 1,
        totalCompCount: 4,
      })
      expect(w.map((x) => x.code)).not.toContain('comps-cross-building')
    })

    it('does NOT fire when subject has no building key (unparseable address)', () => {
      const w = buildReportWarnings({
        ...base,
        subjectHasBuildingKey: false,
        sameBuildingCompCount: 0,
        totalCompCount: 4,
      })
      expect(w.map((x) => x.code)).not.toContain('comps-cross-building')
    })

    it('does NOT fire when there are no comps at all', () => {
      const w = buildReportWarnings({
        ...base,
        subjectHasBuildingKey: true,
        sameBuildingCompCount: 0,
        totalCompCount: 0,
      })
      expect(w.map((x) => x.code)).not.toContain('comps-cross-building')
    })
  })

  // DC Dupont Circle AVM regression — the building has studios ~$247k and
  // junior 1-beds $295–$337k at overlapping ~500 sqft. Rentcast's /avm/value
  // blends both pools and under-prints on a studio. Our bedroom-matched
  // comp median DOES filter by bedroom count; the warning fires when the
  // two diverge enough to be suspicious.
  describe('condo weak same-building support', () => {
    it('flags condo valuations supported by only one same-building comp', () => {
      const w = buildReportWarnings({
        ...base,
        propertyType: 'Condo',
        subjectHasBuildingKey: true,
        sameBuildingCompCount: 1,
        totalCompCount: 4,
      })
      expect(w.map((x) => x.code)).toContain('condo-weak-same-building-support')
    })

    it('does not flag once two or more same-building comps exist', () => {
      const w = buildReportWarnings({
        ...base,
        propertyType: 'Condo',
        subjectHasBuildingKey: true,
        sameBuildingCompCount: 2,
        totalCompCount: 4,
      })
      expect(w.map((x) => x.code)).not.toContain('condo-weak-same-building-support')
    })
  })

  describe('Florida condo diligence warnings', () => {
    it('adds structural and insurance diligence warnings for Florida condos', () => {
      const w = buildReportWarnings({
        ...base,
        state: 'FL',
        propertyType: 'Condo',
        monthlyHOA: 650,
      })
      const codes = w.map((x) => x.code)
      expect(codes).toContain('florida-condo-structural-diligence')
      expect(codes).toContain('florida-condo-insurance-diligence')
    })

    it('does not add Florida condo diligence warnings outside Florida', () => {
      const w = buildReportWarnings({
        ...base,
        state: 'TX',
        propertyType: 'Condo',
        monthlyHOA: 650,
      })
      const codes = w.map((x) => x.code)
      expect(codes).not.toContain('florida-condo-structural-diligence')
      expect(codes).not.toContain('florida-condo-insurance-diligence')
    })
  })

  describe('bedroom-matched-comp-divergence', () => {
    it('fires when same-bed comp median is 18% above AVM with 4 comps (Dupont case)', () => {
      const w = buildReportWarnings({
        ...base,
        subjectAvmValue: 266_000,
        bedroomMatchedCompMedian: 315_000,
        bedroomMatchedCompCount: 4,
      })
      const hit = w.find((x) => x.code === 'bedroom-matched-comp-divergence')
      expect(hit).toBeDefined()
      expect(hit!.message).toContain('$315,000')
      expect(hit!.message).toContain('$266,000')
      expect(hit!.message).toContain('above')
    })

    it('also fires when comp median is BELOW AVM by >15%', () => {
      const w = buildReportWarnings({
        ...base,
        subjectAvmValue: 400_000,
        bedroomMatchedCompMedian: 320_000,
        bedroomMatchedCompCount: 5,
      })
      const hit = w.find((x) => x.code === 'bedroom-matched-comp-divergence')
      expect(hit).toBeDefined()
      expect(hit!.message).toContain('below')
    })

    it('does NOT fire with fewer than 3 comps (too thin to trust)', () => {
      const w = buildReportWarnings({
        ...base,
        subjectAvmValue: 266_000,
        bedroomMatchedCompMedian: 320_000,
        bedroomMatchedCompCount: 2,
      })
      expect(w.map((x) => x.code)).not.toContain('bedroom-matched-comp-divergence')
    })

    it('does NOT fire when divergence is within 15%', () => {
      const w = buildReportWarnings({
        ...base,
        subjectAvmValue: 300_000,
        bedroomMatchedCompMedian: 320_000, // ~6.7% divergence
        bedroomMatchedCompCount: 5,
      })
      expect(w.map((x) => x.code)).not.toContain('bedroom-matched-comp-divergence')
    })

    it('does NOT fire when AVM or comp median is missing', () => {
      expect(
        buildReportWarnings({ ...base, bedroomMatchedCompMedian: 315_000, bedroomMatchedCompCount: 4 })
          .map((x) => x.code)
      ).not.toContain('bedroom-matched-comp-divergence')
      expect(
        buildReportWarnings({ ...base, subjectAvmValue: 266_000, bedroomMatchedCompCount: 4 })
          .map((x) => x.code)
      ).not.toContain('bedroom-matched-comp-divergence')
    })
  })

  // DC Dupont Circle regression — 501 sqft studio was silently assigned 3
  // bedrooms via Rentcast's bedrooms=0 → `|| 3` fallback, producing 167
  // sqft/bed. Warning fires when bedroom count is implausibly high for the
  // building's footprint (the fix to propertyApi eliminates the cascade,
  // this warning catches any residual misclassification).
  describe('bedrooms-implausible for square footage', () => {
    it('flags 3BR on a 501 sqft unit (DC Dupont case)', () => {
      const w = buildReportWarnings({ ...base, bedrooms: 3, squareFeet: 501 })
      const hit = w.find((x) => x.code === 'bedrooms-implausible')
      expect(hit).toBeDefined()
      expect(hit!.message).toContain('(3)')
      expect(hit!.message).toContain('501')
    })

    it('does NOT flag a studio (bedrooms=0)', () => {
      const w = buildReportWarnings({ ...base, bedrooms: 0, squareFeet: 501 })
      expect(w.map((x) => x.code)).not.toContain('bedrooms-implausible')
    })

    it('does NOT flag a normal 3BR 1,500 sqft home (~500 sqft/bed)', () => {
      const w = buildReportWarnings({ ...base, bedrooms: 3, squareFeet: 1500 })
      expect(w.map((x) => x.code)).not.toContain('bedrooms-implausible')
    })

    it('does NOT flag when square footage is unknown', () => {
      const w = buildReportWarnings({ ...base, bedrooms: 3, squareFeet: undefined })
      expect(w.map((x) => x.code)).not.toContain('bedrooms-implausible')
    })

    it('boundary: exactly 200 sqft/bed does NOT flag', () => {
      const w = buildReportWarnings({ ...base, bedrooms: 3, squareFeet: 600 })
      expect(w.map((x) => x.code)).not.toContain('bedrooms-implausible')
    })

    it('boundary: 199 sqft/bed flags', () => {
      const w = buildReportWarnings({ ...base, bedrooms: 3, squareFeet: 597 })
      expect(w.map((x) => x.code)).toContain('bedrooms-implausible')
    })
  })

  // Blacksburg VA regression — Rentcast /properties 404'd, we fell back to
  // synthesizing from AVM. Warning code alerts users that bed/bath/sqft/year
  // were inferred from comparables rather than the subject record.
  describe('property-profile-inferred (AVM-only fallback)', () => {
    it('fires when dataCompleteness is "avm-only"', () => {
      const w = buildReportWarnings({ ...base, dataCompleteness: 'avm-only' })
      expect(w.map((x) => x.code)).toContain('property-profile-inferred')
    })

    it('does not fire when dataCompleteness is "full"', () => {
      const w = buildReportWarnings({ ...base, dataCompleteness: 'full' })
      expect(w.map((x) => x.code)).not.toContain('property-profile-inferred')
    })

    it('does not fire when dataCompleteness is omitted', () => {
      const w = buildReportWarnings({ ...base })
      expect(w.map((x) => x.code)).not.toContain('property-profile-inferred')
    })
  })

  // Bug 3 regression — Old Westbury rent comps spanned $4,800–$19,500
  // with no warning. Rent AVM is unreliable when the comp spread is that wide.
  describe('rent-comps wide spread', () => {
    it('flags 4× spread (Old Westbury case)', () => {
      const w = buildReportWarnings({
        ...base,
        rentCompRents: [4_800, 5_200, 7_000, 9_500, 12_000, 19_500],
      })
      const hit = w.find((x) => x.code === 'rent-comps-wide-spread')
      expect(hit).toBeDefined()
      expect(hit!.message).toContain('$4,800')
      expect(hit!.message).toContain('$19,500')
    })

    it('does not flag 2× spread (normal variation)', () => {
      const w = buildReportWarnings({
        ...base,
        rentCompRents: [2_500, 3_000, 3_500, 4_000, 4_500],
      })
      expect(w.map((x) => x.code)).not.toContain('rent-comps-wide-spread')
    })

    it('does not flag when fewer than 3 comps', () => {
      const w = buildReportWarnings({ ...base, rentCompRents: [1_000, 5_000] })
      expect(w.map((x) => x.code)).not.toContain('rent-comps-wide-spread')
    })

    it('filters non-finite and non-positive rents before computing spread', () => {
      const w = buildReportWarnings({
        ...base,
        rentCompRents: [NaN, 0, -100, 3_000, 3_500, 4_000],
      })
      // 3k–4k = 1.33× → no warning
      expect(w.map((x) => x.code)).not.toContain('rent-comps-wide-spread')
    })
  })
})

// dedupeNearDuplicateComps — Blacksburg regression (Heights Ln cluster).
describe('dedupeNearDuplicateComps', () => {
  const baseComp = { bedrooms: 3, bathrooms: 3.5, square_feet: 1744 }

  it('collapses 201 / 203 / 207 Heights Ln at ~$241k to one rep', () => {
    const comps = [
      { ...baseComp, address: '201 Heights Ln', estimated_value: 240_000 },
      { ...baseComp, address: '203 Heights Ln', estimated_value: 241_000 },
      { ...baseComp, address: '207 Heights Ln', estimated_value: 242_000 },
    ]
    const out = dedupeNearDuplicateComps(comps)
    expect(out).toHaveLength(1)
    expect(out[0].address).toBe('201 Heights Ln')
  })

  it('keeps comps with different bed/bath as separate data points', () => {
    const comps = [
      { ...baseComp, address: '201 Heights Ln', estimated_value: 241_000 },
      {
        bedrooms: 4,
        bathrooms: 3.5,
        square_feet: 1744,
        address: '203 Heights Ln',
        estimated_value: 241_000,
      },
    ]
    expect(dedupeNearDuplicateComps(comps)).toHaveLength(2)
  })

  it('collapses same-street same-footprint units regardless of price spread (post-Blacksburg fix)', () => {
    // Blacksburg Heights Ln: $232k / $235k / $240k / $242k straddled $5k
    // buckets under the old price-bucketed key, so 2 of the 4 survived. New
    // dedup drops the price dimension entirely — same street + identical
    // bed/bath/sqft is presumed same-complex, regardless of $10k+ price
    // variation (typical within a building due to floors / renovations).
    const comps = [
      { ...baseComp, address: '201 Heights Ln', estimated_value: 232_000 },
      { ...baseComp, address: '203 Heights Ln', estimated_value: 235_000 },
      { ...baseComp, address: '205 Heights Ln', estimated_value: 240_000 },
      { ...baseComp, address: '207 Heights Ln', estimated_value: 242_000 },
    ]
    const out = dedupeNearDuplicateComps(comps)
    expect(out).toHaveLength(1)
    expect(out[0].address).toBe('201 Heights Ln')
  })

  it('keeps comps on different streets as separate', () => {
    const comps = [
      { ...baseComp, address: '201 Heights Ln', estimated_value: 241_000 },
      { ...baseComp, address: '210 Berryfield Ln', estimated_value: 241_000 },
    ]
    expect(dedupeNearDuplicateComps(comps)).toHaveLength(2)
  })

  it('handles empty / single-comp arrays', () => {
    expect(dedupeNearDuplicateComps([])).toEqual([])
    const one = [{ ...baseComp, address: '1 Main', estimated_value: 250_000 }]
    expect(dedupeNearDuplicateComps(one)).toEqual(one)
  })

  it('buckets sqft by 100 so 1740/1744/1749 cluster together', () => {
    const comps = [
      { bedrooms: 3, bathrooms: 2, square_feet: 1740, address: '100 Oak St', estimated_value: 300_000 },
      { bedrooms: 3, bathrooms: 2, square_feet: 1744, address: '102 Oak St', estimated_value: 301_000 },
      { bedrooms: 3, bathrooms: 2, square_feet: 1749, address: '104 Oak St', estimated_value: 302_000 },
    ]
    expect(dedupeNearDuplicateComps(comps)).toHaveLength(1)
  })
})

// Regression for Baltimore 414 Water St #1501 audit. The report showed AVM
// $216K as primaryValue while reporting spread 66% + confidence 'low' — the
// single-point headline was not coherent with the triangulation state.
describe('buildValueTriangulationOutput', () => {
  it('suppresses headline when confidence=low AND spread > 30%', () => {
    const out = buildValueTriangulationOutput({
      signals: [
        { label: 'AVM', value: 216_000, source: 'Rentcast AVM' },
        { label: 'Comp median', value: 380_000, source: 'Median of 1 comp' },
      ],
      signalPoints: [216_000, 380_000],
      primaryValue: 216_000,
      valueSource: 'avm',
      spread: 0.66,
      confidence: 'low',
      askPrice: 216_000,
    })
    expect(out.headlineSuppressed).toBe(true)
    expect(out.displayRange).toEqual({ low: 216_000, high: 380_000 })
    expect(out.spreadPct).toBeCloseTo(66, 1)
  })

  it('does NOT suppress when confidence is medium/high', () => {
    const out = buildValueTriangulationOutput({
      signals: [],
      signalPoints: [200_000, 210_000],
      primaryValue: 205_000,
      valueSource: 'avm',
      spread: 0.05,
      confidence: 'high',
      askPrice: 210_000,
    })
    expect(out.headlineSuppressed).toBe(false)
    expect(out.displayRange).toBeNull()
  })

  it('does NOT suppress when spread <= 30% even at low confidence', () => {
    const out = buildValueTriangulationOutput({
      signals: [],
      signalPoints: [200_000, 230_000],
      primaryValue: 215_000,
      valueSource: 'avm',
      spread: 0.15,
      confidence: 'low',
      askPrice: 215_000,
    })
    expect(out.headlineSuppressed).toBe(false)
    expect(out.displayRange).toBeNull()
  })

  it('flags AVM=ask as likely anchoring', () => {
    const out = buildValueTriangulationOutput({
      signals: [],
      signalPoints: [216_000],
      primaryValue: 216_000,
      valueSource: 'avm',
      spread: 0,
      confidence: 'low',
      askPrice: 216_000,
    })
    expect(out.avmEqualsAsk).toBe(true)
  })

  it('does not flag AVM=ask when they differ materially', () => {
    const out = buildValueTriangulationOutput({
      signals: [],
      signalPoints: [216_000],
      primaryValue: 216_000,
      valueSource: 'avm',
      spread: 0,
      confidence: 'medium',
      askPrice: 240_000,
    })
    expect(out.avmEqualsAsk).toBe(false)
  })
})

// Regression for Baltimore 414 Water St #1501 audit. comparableSales field
// was returning the raw comp list (2 cross-neighborhood) while the median
// was computed from same-building comps (1) — the displayed count did not
// match the triangulation text. selectCompsForArv is now the single source
// of truth for both.
describe('selectCompsForArv', () => {
  it('returns only same-building comps when ≥3 exist (stable-median threshold)', () => {
    const comps = [
      { address: '414 Water St #1201', same_building: true, estimated_value: 210_000 },
      { address: '414 Water St #1402', same_building: true, estimated_value: 216_000 },
      { address: '414 Water St #1501', same_building: true, estimated_value: 218_000 },
      { address: '657 Washington Blvd A', same_building: false, estimated_value: 323_000 },
      { address: '657 Washington Blvd B', same_building: false, estimated_value: 380_000 },
    ]
    const result = selectCompsForArv(comps)
    expect(result).toHaveLength(3)
    expect(result.every(c => c.same_building)).toBe(true)
  })

  it('falls back to all comps when none are same-building', () => {
    const comps = [
      { address: '500 Main St', same_building: false, estimated_value: 200_000 },
      { address: '600 Main St', same_building: false, estimated_value: 210_000 },
    ]
    expect(selectCompsForArv(comps)).toHaveLength(2)
  })

  it('handles empty / invalid input', () => {
    expect(selectCompsForArv([])).toEqual([])
    expect(selectCompsForArv(null as any)).toEqual([])
  })
})

// Regression for 414 Water St #1501 audit: all 4 rent comps at the subject
// building, all days_old=1 (active asking rents, not signed leases). Pre-fix
// the report surfaced no warning — user had no signal that the rent anchor
// was single-owner concentrated.
describe('buildSameBuildingRentCompWarning', () => {
  const subjectAddress = '414 Water St #1501, Baltimore, MD 21202'
  const sameBuildingComps = [
    { address: '414 Water St #1201', rent: 2450, days_old: 1 },
    { address: '414 Water St #1402', rent: 2500, days_old: 1 },
    { address: '414 Water St #903', rent: 2480, days_old: 1 },
    { address: '414 Water St #704', rent: 2510, days_old: 1 },
  ]

  it('fires when all rent comps share the subject building', () => {
    const w = buildSameBuildingRentCompWarning(subjectAddress, sameBuildingComps)
    expect(w).toBeTruthy()
    expect(w).toMatch(/subject building/i)
    expect(w).toMatch(/concession haircut/i)
  })

  it('mentions active-listing bias when every comp is fresh (days_old ≤ 7)', () => {
    const w = buildSameBuildingRentCompWarning(subjectAddress, sameBuildingComps)
    expect(w).toMatch(/active listings under 7 days old/i)
  })

  it('does NOT fire when at least one comp is in a different building', () => {
    const mixed = [
      ...sameBuildingComps.slice(0, 3),
      { address: '100 Pratt St #501', rent: 2400, days_old: 2 },
    ]
    expect(buildSameBuildingRentCompWarning(subjectAddress, mixed)).toBeNull()
  })

  it('does NOT fire with fewer than 3 comps', () => {
    expect(
      buildSameBuildingRentCompWarning(subjectAddress, sameBuildingComps.slice(0, 2))
    ).toBeNull()
  })

  it('does NOT fire when subject has no parseable building key', () => {
    expect(
      buildSameBuildingRentCompWarning('', sameBuildingComps)
    ).toBeNull()
  })

  it('handles empty / non-array input', () => {
    expect(buildSameBuildingRentCompWarning(subjectAddress, [])).toBeNull()
    expect(buildSameBuildingRentCompWarning(subjectAddress, null as any)).toBeNull()
  })
})

// Regression for 414 Water St #1501 audit: summaryCard.breakeven = $138k
// (teaser) but recommendedOffers.breakevenPrice = $148k and the AI narrative
// said "renegotiate to $148,000". All three now resolve to one canonical
// number so the user never sees a $10k internal mismatch.
describe('resolveCanonicalBreakeven', () => {
  it('prefers the teaser breakeven when present (object form)', () => {
    expect(
      resolveCanonicalBreakeven({ breakevenPrice: 138_000 }, 148_000)
    ).toBe(138_000)
  })

  it('prefers the teaser breakeven when present (JSON string form)', () => {
    expect(
      resolveCanonicalBreakeven('{"breakevenPrice":138000}', 148_000)
    ).toBe(138_000)
  })

  it('falls back to recommendedOffers when teaser is missing', () => {
    expect(resolveCanonicalBreakeven(null, 148_000)).toBe(148_000)
    expect(resolveCanonicalBreakeven(undefined, 148_000)).toBe(148_000)
  })

  it('falls back to recommendedOffers when teaser breakeven is 0 / non-finite', () => {
    expect(
      resolveCanonicalBreakeven({ breakevenPrice: 0 }, 148_000)
    ).toBe(148_000)
    expect(
      resolveCanonicalBreakeven({ breakevenPrice: NaN }, 148_000)
    ).toBe(148_000)
    expect(resolveCanonicalBreakeven({}, 148_000)).toBe(148_000)
  })

  it('falls back when teaser JSON is malformed', () => {
    expect(
      resolveCanonicalBreakeven('not-json{oops', 148_000)
    ).toBe(148_000)
  })
})

// regression: 414 Water St #1501 audit — sole sale comp was 657 Washington
// Blvd Apt B (ZIP 21230, Ridgely's Delight townhouse, 1,454 sqft) used as a
// comp for a 1,067 sqft urban high-rise condo in 21202. selectCompsForArv
// must drop cross-ZIP and cross-subtype comps before falling back to the
// unfiltered list, so the displayed ARV is not anchored to a townhouse in
// a different submarket.
describe('selectCompsForArv cross-ZIP / cross-subtype filter', () => {
  const subject = {
    zip_code: '21202',
    property_type: 'Condo',
    square_feet: 1067,
  }

  it('filters out cross-ZIP townhouse comp when subject is urban high-rise condo', () => {
    const comps = [
      {
        address: '657 Washington Blvd B, Baltimore, MD 21230',
        zip_code: '21230',
        property_type: 'Townhouse',
        square_feet: 1454,
        same_building: false,
        estimated_value: 323_000,
      },
    ]
    const result = (selectCompsForArv as any)(comps, subject)
    expect(result).toHaveLength(0)
  })

  it('keeps in-ZIP in-subtype comps even when same_building=false', () => {
    const comps = [
      {
        address: '100 Pier 5 Blvd #303, Baltimore, MD 21202',
        zip_code: '21202',
        property_type: 'Condo',
        square_feet: 1100,
        same_building: false,
        estimated_value: 245_000,
      },
    ]
    const result = (selectCompsForArv as any)(comps, subject)
    expect(result).toHaveLength(1)
  })

  it('supplements with same-ZIP neighbors when same-building count is below threshold', () => {
    const comps = [
      {
        address: '414 Water St #1201',
        zip_code: '21202',
        property_type: 'Condo',
        square_feet: 1067,
        same_building: true,
        estimated_value: 210_000,
      },
      {
        address: '100 Pier 5 Blvd #303',
        zip_code: '21202',
        property_type: 'Condo',
        square_feet: 1100,
        same_building: false,
        estimated_value: 245_000,
      },
    ]
    const result = (selectCompsForArv as any)(comps, subject)
    expect(result).toHaveLength(2)
    expect(result.some((c: any) => c.same_building)).toBe(true)
  })
})

// regression: 414 Water St #1501 audit — AVM $216k literally equaled ask
// $216k while the triangulation spread was 66%. The current suppression
// rule only fires at confidence='low'; the AVM=ask case should suppress
// the headline regardless of confidence, because the point estimate is
// definitionally anchored to the list price, not to market signal.
describe('buildValueTriangulationOutput — avmEqualsAsk suppression', () => {
  it('suppresses headline when avmEqualsAsk=true and spread >25% even at medium confidence', () => {
    const out = buildValueTriangulationOutput({
      signals: [
        { label: 'AVM', value: 216_000, source: 'Rentcast AVM' },
        { label: 'Comp median', value: 276_000, source: 'Median of 3 comps' },
      ],
      signalPoints: [216_000, 276_000],
      primaryValue: 216_000,
      valueSource: 'avm',
      spread: 0.28,
      confidence: 'medium',
      askPrice: 216_000,
    })
    expect(out.avmEqualsAsk).toBe(true)
    expect(out.headlineSuppressed).toBe(true)
  })

  it('still suppresses when avmEqualsAsk=true with spread=0.26 and high confidence', () => {
    const out = buildValueTriangulationOutput({
      signals: [],
      signalPoints: [300_000, 378_000],
      primaryValue: 300_000,
      valueSource: 'avm',
      spread: 0.26,
      confidence: 'high',
      askPrice: 300_000,
    })
    expect(out.avmEqualsAsk).toBe(true)
    expect(out.headlineSuppressed).toBe(true)
  })

  it('does NOT suppress when avmEqualsAsk=true but spread <=25% (tight signals)', () => {
    const out = buildValueTriangulationOutput({
      signals: [],
      signalPoints: [300_000, 340_000],
      primaryValue: 300_000,
      valueSource: 'avm',
      spread: 0.13,
      confidence: 'medium',
      askPrice: 300_000,
    })
    expect(out.avmEqualsAsk).toBe(true)
    expect(out.headlineSuppressed).toBe(false)
  })
})

// regression: 414 Water St #1501 audit — four rent comps, all in the
// subject building, all days_old=1 (active asking rents, not executed
// leases). The warning copy already tells the user to apply a 3–5%
// concession haircut; the haircut must ALSO be applied mechanically to
// the rentEstimate so that breakeven / DSCR / wealth projection downstream
// reflect effective rent, not a top-of-band asking number.
describe('deriveValueConfidence', () => {
  it('forces low confidence for condo values with only one same-building comp', () => {
    const out = deriveValueConfidence({
      signalPoints: [500_000, 510_000],
      estimatedValue: 500_000,
      propertyType: 'Condo',
      subjectHasBuildingKey: true,
      sameBuildingCompCount: 1,
    })
    expect(out.spread).toBeCloseTo(0.02, 3)
    expect(out.confidence).toBe('low')
  })

  it('caps tight-spread condo valuations at medium confidence when only two same-building comps exist', () => {
    const out = deriveValueConfidence({
      signalPoints: [500_000, 510_000],
      estimatedValue: 500_000,
      propertyType: 'Condo',
      subjectHasBuildingKey: true,
      sameBuildingCompCount: 2,
    })
    expect(out.confidence).toBe('medium')
  })

  it('preserves high confidence for non-condo tight-spread valuations', () => {
    const out = deriveValueConfidence({
      signalPoints: [500_000, 510_000],
      estimatedValue: 500_000,
      propertyType: 'Single Family',
      subjectHasBuildingKey: true,
      sameBuildingCompCount: 0,
    })
    expect(out.confidence).toBe('high')
  })
})

describe('computeConcessionHaircutFactor (414 Water St rent audit)', () => {
  const subjectAddress = '414 Water St #1501, Baltimore, MD 21202'
  const freshSameBuilding = [
    { address: '414 Water St #1201', rent: 2450, days_old: 1 },
    { address: '414 Water St #1402', rent: 2500, days_old: 1 },
    { address: '414 Water St #903', rent: 2480, days_old: 1 },
    { address: '414 Water St #704', rent: 2510, days_old: 1 },
  ]

  it('is exported as a helper', () => {
    const fn = (reportGenerator as any).computeConcessionHaircutFactor
    expect(typeof fn).toBe('function')
  })

  it('returns a haircut factor in [0.95, 0.97] when all comps are same-building and fresh (<7d)', () => {
    const fn = (reportGenerator as any).computeConcessionHaircutFactor
    const factor = fn(subjectAddress, freshSameBuilding)
    expect(factor).toBeGreaterThanOrEqual(0.95)
    expect(factor).toBeLessThanOrEqual(0.97)
  })

  it('returns 1.0 (no haircut) when comps span multiple buildings', () => {
    const fn = (reportGenerator as any).computeConcessionHaircutFactor
    const mixed = [
      ...freshSameBuilding.slice(0, 3),
      { address: '100 Pratt St #501', rent: 2400, days_old: 2 },
    ]
    expect(fn(subjectAddress, mixed)).toBe(1.0)
  })

  it('returns 1.0 (no haircut) when comps are aged signed leases (days_old > 30)', () => {
    const fn = (reportGenerator as any).computeConcessionHaircutFactor
    const aged = freshSameBuilding.map((c) => ({ ...c, days_old: 45 }))
    expect(fn(subjectAddress, aged)).toBe(1.0)
  })
})

// regression: 414 Water St #1501 audit — Baltimore City Code §5A prohibits
// non-owner-occupied whole-unit STR. The report still rendered a
// strProjection card with $0 revenue and a -$1,756/mo net line, which
// reads as "the STR optionality shows a $21k/yr loss" rather than "STR is
// legally off the table". When prohibited and not owner-occupied, the card
// must be suppressed entirely.
describe('shouldIncludeStrProjection (Baltimore §5A audit)', () => {
  it('is exported as a helper', () => {
    const fn = (reportGenerator as any).shouldIncludeStrProjection
    expect(typeof fn).toBe('function')
  })

  it('returns false for Baltimore MD investor (non-OO) properties', () => {
    const fn = (reportGenerator as any).shouldIncludeStrProjection
    expect(fn({ state: 'MD', city: 'Baltimore', ownerOccupied: false })).toBe(false)
  })

  it('returns false for NYC investor (non-OO) properties (Local Law 18)', () => {
    const fn = (reportGenerator as any).shouldIncludeStrProjection
    expect(fn({ state: 'NY', city: 'Brooklyn', ownerOccupied: false })).toBe(false)
  })

  it('returns true for jurisdictions without an investor-STR ban', () => {
    const fn = (reportGenerator as any).shouldIncludeStrProjection
    expect(fn({ state: 'TX', city: 'Austin', ownerOccupied: false })).toBe(true)
    expect(fn({ state: 'FL', city: 'Miami', ownerOccupied: false })).toBe(true)
  })

  it('returns true when the unit is owner-occupied (primary-residence carve-out applies)', () => {
    const fn = (reportGenerator as any).shouldIncludeStrProjection
    expect(fn({ state: 'MD', city: 'Baltimore', ownerOccupied: true })).toBe(true)
  })
})

// regression: 414 Water St #1501 audit (QA v22) — Rentcast returned only a
// single cross-building comp. selectCompsForArv happily emitted it as the
// sole anchor because the same-building branch exits at length >= 1. For a
// condo subject, one same-building comp is not enough signal — the selector
// must require at least 3 same-building closings before gating out the ZIP
// supplement, otherwise a single outlier in the building anchors the ARV.
describe('selectCompsForArv same-building minimum (414 Water St audit)', () => {
  const subject = {
    zip_code: '21202',
    property_type: 'Condo',
    square_feet: 1067,
  }

  it('supplements with same-ZIP same-subtype when fewer than 3 same-building comps exist', () => {
    const comps = [
      { address: '414 Water St #1201, Baltimore, MD 21202', zip_code: '21202', property_type: 'Condo', square_feet: 1067, same_building: true, estimated_value: 210_000 },
      { address: '100 Pier 5 Blvd #303, Baltimore, MD 21202', zip_code: '21202', property_type: 'Condo', square_feet: 1100, same_building: false, estimated_value: 245_000 },
      { address: '625 President St #1504, Baltimore, MD 21202', zip_code: '21202', property_type: 'Condo', square_feet: 1080, same_building: false, estimated_value: 255_000 },
      { address: '801 Key Hwy #250, Baltimore, MD 21202', zip_code: '21202', property_type: 'Condo', square_feet: 1050, same_building: false, estimated_value: 265_000 },
    ]
    const result = (selectCompsForArv as any)(comps, subject)
    // With only 1 same-building comp, selector must fall back / supplement.
    // Anchoring an ARV on a single same-building closing is exactly the
    // failure mode the audit uncovered.
    expect(result.length).toBeGreaterThanOrEqual(3)
  })
})

// regression: 414 Water St #1501 audit (QA v22) — sole sale comp was
// 657 Washington Blvd Apt B, 1,454 sqft — 36% larger than the 1,067 sqft
// subject. Even with matching ZIP + subtype, a 36%+ size mismatch is a
// different product: different bedroom count, different layout, different
// price/sqft band. selectCompsForArv must drop size-outlier comps to
// prevent the ARV from anchoring to a different product type.
describe('selectCompsForArv size-outlier guard (414 Water St audit)', () => {
  const subject = {
    zip_code: '21202',
    property_type: 'Condo',
    square_feet: 1067,
  }

  it('drops same-ZIP same-subtype comp that is 36%+ larger than subject', () => {
    const comps = [
      {
        address: '500 Oversized Condo St, Baltimore, MD 21202',
        zip_code: '21202',
        property_type: 'Condo',
        square_feet: 1454, // 36% bigger than 1067
        same_building: false,
        estimated_value: 323_000,
      },
    ]
    const result = (selectCompsForArv as any)(comps, subject)
    expect(result).toHaveLength(0)
  })

  it('keeps comps within ±25% sqft of subject', () => {
    const comps = [
      {
        address: '700 Right-Sized Condo St, Baltimore, MD 21202',
        zip_code: '21202',
        property_type: 'Condo',
        square_feet: 1150, // ~8% bigger — acceptable
        same_building: false,
        estimated_value: 235_000,
      },
    ]
    const result = (selectCompsForArv as any)(comps, subject)
    expect(result).toHaveLength(1)
  })
})

// regression: 414 Water St #1501 audit (QA v22) — avmEqualsAsk=true with
// 66% triangulation spread. Current behavior suppresses the headline and
// exposes a displayRange, but the report still shows no replacement anchor
// for downstream math. Bug direction: "fall back to same-building median".
// The output should expose a fallbackValue + fallbackSource so the report
// can render 'value unknown — anchor to same-building median $218K'
// instead of echoing the ask.
describe('buildValueTriangulationOutput — same-building fallback anchor', () => {
  it('exposes fallbackValue and fallbackSource when headline is suppressed', () => {
    const out = buildValueTriangulationOutput({
      signals: [
        { label: 'AVM', value: 216_000, source: 'Rentcast AVM' },
        { label: 'Same-building median', value: 218_000, source: '3 same-building closings' },
        { label: 'Comp median', value: 380_000, source: 'cross-neighborhood' },
      ],
      signalPoints: [216_000, 218_000, 380_000],
      primaryValue: 216_000,
      valueSource: 'avm',
      spread: 0.66,
      confidence: 'low',
      askPrice: 216_000,
      sameBuildingMedian: 218_000,
    } as any)
    expect(out.headlineSuppressed).toBe(true)
    expect((out as any).fallbackValue).toBe(218_000)
    expect((out as any).fallbackSource).toMatch(/same.?building/i)
  })
})

// regression: 414 Water St #1501 audit (QA v22) — four same-building
// active-asking rent comps, warning text says "Apply a 3–5% concession
// haircut" as if it's the user's job. Bug direction: "apply a 3–5%
// concession haircut in calculation, not just in warning text". After
// the fix, the warning copy must confirm the haircut HAS BEEN applied to
// the rentEstimate, not ask the user to apply it mentally.
describe('buildSameBuildingRentCompWarning — confirms haircut is applied mechanically', () => {
  const subjectAddress = '414 Water St #1501, Baltimore, MD 21202'
  const sameBuildingComps = [
    { address: '414 Water St #1201', rent: 2450, days_old: 1 },
    { address: '414 Water St #1402', rent: 2500, days_old: 1 },
    { address: '414 Water St #903', rent: 2480, days_old: 1 },
    { address: '414 Water St #704', rent: 2510, days_old: 1 },
  ]

  it('warning confirms the haircut was applied (past tense), not just recommended', () => {
    const w = buildSameBuildingRentCompWarning(subjectAddress, sameBuildingComps)
    expect(w).toBeTruthy()
    // Past-tense "applied" means the calc engine handled it; imperative
    // "Apply" leaves it as an unfulfilled user TODO.
    expect(w).toMatch(/\bapplied\b/i)
  })
})

// ─── resolvePropertyTax ───────────────────────────────────────────────────────
// Covers every branch of the tax source decision tree:
//   county-record  →  Rentcast annualPropertyTax is positive and sane
//   city-override  →  Rentcast missing, but CITY_RULES has a rate for this city
//   state-average  →  Rentcast missing, no city override
// Plus building-level rejection (3× state-avg and >60% AVM) and edge cases.

describe('resolvePropertyTax', () => {
  // ── Group 1: county-record happy path ────────────────────────────────────
  it('uses county-record when Rentcast annual_property_tax is positive', () => {
    // $7,200/yr → $600/mo; TX state rate 1.8% on $400k → $600/mo state-avg
    // county-record should win because it is present and not building-level
    const result = resolvePropertyTax({
      annualPropertyTax: 7200,
      offerPrice: 400_000,
      statePropertyTaxRate: 0.018,
      hasCityTaxOverride: false,
      city: 'AUSTIN',
      state: 'TX',
    })
    expect(result.propertyTaxSource).toBe('county-record')
    expect(result.monthlyPropertyTax).toBe(600)
    expect(result.taxIsBuildingLevel).toBe(false)
  })

  it('rounds county-record to nearest dollar', () => {
    // $7,001/yr → 583.416… → rounds to $583
    const result = resolvePropertyTax({
      annualPropertyTax: 7001,
      offerPrice: 400_000,
      statePropertyTaxRate: 0.018,
      hasCityTaxOverride: false,
      city: 'AUSTIN',
      state: 'TX',
    })
    expect(result.propertyTaxSource).toBe('county-record')
    expect(result.monthlyPropertyTax).toBe(583)
  })

  it('county-record beats city-override when Rentcast data is present and sane', () => {
    // Even if CITY_RULES has a rate (hasCityTaxOverride: true), actual Rentcast
    // data is more accurate and should take precedence.
    const result = resolvePropertyTax({
      annualPropertyTax: 7200,
      offerPrice: 400_000,
      statePropertyTaxRate: 0.018,
      hasCityTaxOverride: true,
      city: 'HOUSTON',
      state: 'TX',
    })
    expect(result.propertyTaxSource).toBe('county-record')
    expect(result.monthlyPropertyTax).toBe(600)
  })

  // ── Group 2: city-override path ───────────────────────────────────────────
  it('falls back to city-override when annualPropertyTax is undefined', () => {
    const result = resolvePropertyTax({
      annualPropertyTax: undefined,
      offerPrice: 400_000,
      statePropertyTaxRate: 0.018,
      hasCityTaxOverride: true,
      city: 'HOUSTON',
      state: 'TX',
    })
    expect(result.propertyTaxSource).toBe('city-override')
  })

  it('falls back to city-override when annualPropertyTax is 0', () => {
    // 0 is treated as missing (Rentcast sentinel for no data)
    const result = resolvePropertyTax({
      annualPropertyTax: 0,
      offerPrice: 400_000,
      statePropertyTaxRate: 0.018,
      hasCityTaxOverride: true,
      city: 'HOUSTON',
      state: 'TX',
    })
    expect(result.propertyTaxSource).toBe('city-override')
  })

  // ── Group 3: state-average fallback ──────────────────────────────────────
  it('falls back to state-average when Rentcast missing and no city override', () => {
    const result = resolvePropertyTax({
      annualPropertyTax: undefined,
      offerPrice: 300_000,
      statePropertyTaxRate: 0.01,
      hasCityTaxOverride: false,
      city: 'NOWHERE',
      state: 'OH',
    })
    expect(result.propertyTaxSource).toBe('state-average')
    // $300k × 1% / 12 = $250
    expect(result.monthlyPropertyTax).toBe(250)
  })

  it('falls back to state-average when annualPropertyTax is 0 and no city override', () => {
    const result = resolvePropertyTax({
      annualPropertyTax: 0,
      offerPrice: 300_000,
      statePropertyTaxRate: 0.01,
      hasCityTaxOverride: false,
      city: 'NOWHERE',
      state: 'OH',
    })
    expect(result.propertyTaxSource).toBe('state-average')
    expect(result.monthlyPropertyTax).toBe(250)
  })

  // ── Group 4: building-level rejection — 3× state-average threshold ────────
  it('rejects building-level county-record exceeding 3× state-average', () => {
    // $22,000/yr on $400k TX (state-avg $600/mo) → county-record $1,833/mo > 3×$600=$1,800
    const result = resolvePropertyTax({
      annualPropertyTax: 22_000,
      offerPrice: 400_000,
      statePropertyTaxRate: 0.018,
      hasCityTaxOverride: false,
      city: 'AUSTIN',
      state: 'TX',
    })
    expect(result.taxIsBuildingLevel).toBe(true)
    expect(result.propertyTaxSource).not.toBe('county-record')
  })

  it('does NOT reject when county-record equals exactly 3× state-average (strictly-greater threshold)', () => {
    // $21,600/yr → $1,800/mo exactly; state-avg $600/mo → exactly 3× but NOT > 3×
    const result = resolvePropertyTax({
      annualPropertyTax: 21_600,
      offerPrice: 400_000,
      statePropertyTaxRate: 0.018,
      hasCityTaxOverride: false,
      city: 'AUSTIN',
      state: 'TX',
    })
    expect(result.taxIsBuildingLevel).toBe(false)
    expect(result.propertyTaxSource).toBe('county-record')
  })

  it('rejects Bronx audit case: $1,025,784/yr on $223k offer (building-level multi-unit)', () => {
    // Real audit case that surfaced building-level tax bleeding into unit calculations.
    // $1,025,784 / 12 = $85,482/mo; state-avg: $223k × 1.25% / 12 ≈ $232/mo → far > 3×
    const result = resolvePropertyTax({
      annualPropertyTax: 1_025_784,
      offerPrice: 223_000,
      statePropertyTaxRate: 0.0125,
      hasCityTaxOverride: false,
      city: 'BRONX',
      state: 'NY',
    })
    expect(result.taxIsBuildingLevel).toBe(true)
    expect(result.propertyTaxSource).not.toBe('county-record')
  })

  // ── Group 5: building-level rejection — >60% AVM threshold ───────────────
  // To isolate the 60%-AVM condition independently of the 3× condition we
  // use an artificially high statePropertyTaxRate (25%) so that 3× state-avg
  // sits above the 60%-boundary county-record figure.
  //   offerPrice=$200k, stateRate=25% → stateAvg=$4,167/mo → 3×=$12,500/mo
  //   60% boundary = $120k/yr → $10,000/mo < $12,500  (3× guard silent here)
  it('rejects county-record when annual tax exceeds 60% of offer price', () => {
    // $125,000/yr on $200k → 62.5% of AVM → building-level via >60% path
    // countyRecordTax $10,417/mo < 3×$4,167=$12,500 → 3× guard does NOT fire
    const result = resolvePropertyTax({
      annualPropertyTax: 125_000,
      offerPrice: 200_000,
      statePropertyTaxRate: 0.25,
      hasCityTaxOverride: false,
      city: 'TESTVILLE',
      state: 'TX',
    })
    expect(result.taxIsBuildingLevel).toBe(true)
  })

  it('does NOT reject when annual tax equals exactly 60% of offer price (strictly-greater threshold)', () => {
    // $120,000/yr on $200k → exactly 60% → NOT rejected (strict >)
    // countyRecordTax $10,000/mo < 3×$4,167=$12,500 → 3× guard also silent
    const result = resolvePropertyTax({
      annualPropertyTax: 120_000,
      offerPrice: 200_000,
      statePropertyTaxRate: 0.25,
      hasCityTaxOverride: false,
      city: 'TESTVILLE',
      state: 'TX',
    })
    expect(result.taxIsBuildingLevel).toBe(false)
  })

  // ── Group 6: edge cases ───────────────────────────────────────────────────
  it('handles undefined annualPropertyTax without throwing', () => {
    expect(() =>
      resolvePropertyTax({
        annualPropertyTax: undefined,
        offerPrice: 300_000,
        statePropertyTaxRate: 0.01,
        hasCityTaxOverride: false,
        city: 'NOWHERE',
        state: 'OH',
      })
    ).not.toThrow()
    const result = resolvePropertyTax({
      annualPropertyTax: undefined,
      offerPrice: 300_000,
      statePropertyTaxRate: 0.01,
      hasCityTaxOverride: false,
      city: 'NOWHERE',
      state: 'OH',
    })
    expect(result.taxIsBuildingLevel).toBe(false)
    expect(result.propertyTaxSource).toBe('state-average')
  })

  it('treats negative annualPropertyTax as missing (no county-record path)', () => {
    const result = resolvePropertyTax({
      annualPropertyTax: -100,
      offerPrice: 300_000,
      statePropertyTaxRate: 0.01,
      hasCityTaxOverride: false,
      city: 'NOWHERE',
      state: 'OH',
    })
    expect(result.propertyTaxSource).toBe('state-average')
    expect(result.taxIsBuildingLevel).toBe(false)
  })

  it('does not divide by zero when offerPrice is 0', () => {
    expect(() =>
      resolvePropertyTax({
        annualPropertyTax: 7200,
        offerPrice: 0,
        statePropertyTaxRate: 0.018,
        hasCityTaxOverride: false,
        city: 'AUSTIN',
        state: 'TX',
      })
    ).not.toThrow()
  })
})
