import { describe, it, expect } from 'vitest'
import { estimateSTRRevenue, addCommasToNumbers } from './dealDoctor'
import * as dealDoctor from './dealDoctor'

// Claude sometimes drops thousands separators in generated text ("$284000"
// instead of "$284,000"). We post-process its output before parsing so every
// downstream field renders with properly-formatted numbers.
describe('addCommasToNumbers', () => {
  it('adds commas to 4-digit dollar amounts', () => {
    expect(addCommasToNumbers('Credit of $3900')).toBe('Credit of $3,900')
  })

  it('adds commas to 6-digit dollar amounts', () => {
    expect(addCommasToNumbers('Ask is $284000 firm')).toBe('Ask is $284,000 firm')
  })

  it('leaves already-formatted numbers alone', () => {
    expect(addCommasToNumbers('Price: $270,000 target')).toBe('Price: $270,000 target')
  })

  it('preserves decimal portions', () => {
    expect(addCommasToNumbers('Payment $1234.56/mo')).toBe('Payment $1,234.56/mo')
  })

  it('does not touch small numbers', () => {
    expect(addCommasToNumbers('Save $500/mo')).toBe('Save $500/mo')
  })

  it('does not touch bare years (no $ prefix)', () => {
    expect(addCommasToNumbers('Built in 1985, sold 2023')).toBe('Built in 1985, sold 2023')
  })

  it('formats multiple values in one string', () => {
    expect(addCommasToNumbers('Rent $3900/mo, ask $284000, rehab $15000'))
      .toBe('Rent $3,900/mo, ask $284,000, rehab $15,000')
  })
})


// STR revenue anchors one of the AI's three fix recommendations. If a 4BR Miami
// property gets the same $4500/mo estimate as a studio, the pivot strategy is
// miscalibrated. These tests guard the bedroom multipliers.
describe('estimateSTRRevenue', () => {
  it('2BR is the city baseline', () => {
    expect(estimateSTRRevenue('Miami', 'FL', 2)).toBe(4500)
    expect(estimateSTRRevenue('Austin', 'TX', 2)).toBe(3500)
  })

  it('3BR is ~1.3× baseline', () => {
    expect(estimateSTRRevenue('Miami', 'FL', 3)).toBe(Math.round(4500 * 1.3))
  })

  it('4BR is ~1.6× baseline', () => {
    expect(estimateSTRRevenue('Miami', 'FL', 4)).toBe(Math.round(4500 * 1.6))
  })

  it('Studio (0BR) is ~0.55× baseline', () => {
    expect(estimateSTRRevenue('Miami', 'FL', 0)).toBe(Math.round(4500 * 0.55))
  })

  it('1BR is ~0.75× baseline', () => {
    expect(estimateSTRRevenue('Miami', 'FL', 1)).toBe(Math.round(4500 * 0.75))
  })

  it('clamps bedroom count to 6 (no infinite scaling)', () => {
    const six = estimateSTRRevenue('Miami', 'FL', 6)
    const ten = estimateSTRRevenue('Miami', 'FL', 10)
    expect(ten).toBe(six)
  })

  it('unknown city falls back to $2500 baseline', () => {
    expect(estimateSTRRevenue('Nowhereville', 'WY', 2)).toBe(2500)
  })

  it('matches city by substring (case-insensitive)', () => {
    // "Los Angeles, CA" should match "los angeles"
    expect(estimateSTRRevenue('LOS ANGELES', 'CA', 2)).toBe(4800)
    expect(estimateSTRRevenue('los angeles', 'CA', 2)).toBe(4800)
  })

  it('no bedrooms = baseline only (no multiplier applied)', () => {
    expect(estimateSTRRevenue('Miami', 'FL')).toBe(4500)
  })

  // NYC STR legal-restriction suppression (Bug F regression).
  // NYC Local Law 18 effectively bans <30-day STR. The estimator used to
  // return $5,500/mo × bedroom multiplier anyway, making the strategy look
  // viable in the report. Post-fix: returns 0 for any NYC borough.
  it('NYC boroughs return 0 (Local Law 18 ban)', () => {
    expect(estimateSTRRevenue('New York', 'NY', 2)).toBe(0)
    expect(estimateSTRRevenue('Manhattan', 'NY', 3)).toBe(0)
    expect(estimateSTRRevenue('Brooklyn', 'NY', 2)).toBe(0)
    expect(estimateSTRRevenue('Queens', 'NY', 4)).toBe(0)
    expect(estimateSTRRevenue('Bronx', 'NY', 2)).toBe(0)
    expect(estimateSTRRevenue('Staten Island', 'NY', 2)).toBe(0)
  })

  it('non-NYC NY cities still produce revenue (Buffalo, Albany)', () => {
    expect(estimateSTRRevenue('Buffalo', 'NY', 2)).toBeGreaterThan(0)
    expect(estimateSTRRevenue('Albany', 'NY', 2)).toBeGreaterThan(0)
  })

  it('NYC-named cities outside NY state are not zeroed', () => {
    expect(estimateSTRRevenue('New York Mills', 'MN', 2)).toBeGreaterThan(0)
  })

  it('scales monotonically with bedrooms', () => {
    const rev = [0, 1, 2, 3, 4, 5].map((b) => estimateSTRRevenue('Miami', 'FL', b))
    for (let i = 1; i < rev.length; i++) {
      expect(rev[i]).toBeGreaterThan(rev[i - 1])
    }
  })
})

// regression: 414 Water St #1501 audit — AI diagnosis said "This 1-bed condo
// is asking $216,000..." for a unit whose structured data was 2 bedrooms /
// 2 baths / 1,067 sqft. Prose must be gated on structured bedroom count via
// a post-parse assertion so a hallucinated bedroom phrase fails closed.
describe('validateDiagnosisBedroomPhrase (414 Water St audit)', () => {
  it('is exported as a helper', () => {
    const fn = (dealDoctor as any).validateDiagnosisBedroomPhrase
    expect(typeof fn).toBe('function')
  })

  it('rejects a "1-bed" phrase on a 2BR property', () => {
    const fn = (dealDoctor as any).validateDiagnosisBedroomPhrase
    expect(fn('This 1-bed condo is asking $216,000 in Baltimore.', 2)).toBe(false)
  })

  it('rejects "studio" phrasing on a 2BR property', () => {
    const fn = (dealDoctor as any).validateDiagnosisBedroomPhrase
    expect(fn('This studio condo is asking $216,000.', 2)).toBe(false)
  })

  it('accepts matching "2-bed" phrase on a 2BR property', () => {
    const fn = (dealDoctor as any).validateDiagnosisBedroomPhrase
    expect(fn('This 2-bed condo is asking $216,000.', 2)).toBe(true)
  })

  it('accepts "two-bedroom" word form on a 2BR property', () => {
    const fn = (dealDoctor as any).validateDiagnosisBedroomPhrase
    expect(fn('A two-bedroom high-rise condo asking $216,000.', 2)).toBe(true)
  })

  it('is a no-op (returns true) when the diagnosis contains no bedroom phrase', () => {
    const fn = (dealDoctor as any).validateDiagnosisBedroomPhrase
    expect(fn('Asking price is at the top of the band for this submarket.', 2)).toBe(true)
  })
})
