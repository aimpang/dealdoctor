// US rate data — FRED API (Federal Reserve Economic Data) is free
// No API key required for basic observations

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'

export interface CurrentRates {
  fedFundsRate: number         // Federal funds rate
  treasuryYield10yr: number    // 10-year Treasury yield
  mortgage30yr: number         // Freddie Mac 30-year fixed average (owner-occupied PMMS)
  mortgage15yr: number         // Freddie Mac 15-year fixed average (owner-occupied PMMS)
}

// Freddie Mac PMMS reports owner-occupied rates. Investor loans price higher
// because lenders treat non-owner-occupied as riskier. Typical premiums over
// PMMS for conforming loans with 20-25% down, ~2026 market:
//   - DSCR / non-owner-occupied LTR: +75 bps
//   - STR-permitted loans (stricter underwriting): +100 bps
//   - Fix-and-flip / hard money: +150 bps (and these are usually short-term, not 30yr)
// Showing PMMS to an investor without this premium flips DEAL/PASS verdicts on
// marginal properties by $200-300/mo in payment. Always apply.
export const INVESTOR_PREMIUM = {
  LTR: 0.0075,
  STR: 0.0100,
  FLIP: 0.0150,
  PRIMARY: 0, // owner-occupied — no premium
} as const

export type Strategy = keyof typeof INVESTOR_PREMIUM

export function applyInvestorPremium(
  pmmsRate: number,
  strategy: Strategy = 'LTR'
): number {
  return pmmsRate + INVESTOR_PREMIUM[strategy]
}

let warnedAboutMissingKey = false

export async function getCurrentRates(): Promise<CurrentRates> {
  try {
    // FRED requires an API key. Provision FRED_API_KEY in env (free:
    // https://fred.stlouisfed.org/docs/api/api_key.html). Without a real key,
    // DEMO_KEY is throttled to ~120 req/day and returns errors unpredictably
    // — which silently falls through to the hardcoded 6.5% / 5.8% fallback
    // below, making every rate-derived figure in the report stale.
    const fredKey = process.env.FRED_API_KEY || 'DEMO_KEY'
    if (fredKey === 'DEMO_KEY' && !warnedAboutMissingKey) {
      warnedAboutMissingKey = true
      console.warn('[rates] FRED_API_KEY not set — using DEMO_KEY (throttled). PMMS will fall back to hardcoded 6.5% when throttled.')
    }
    const [rate30Res, rate15Res] = await Promise.all([
      // MORTGAGE30US: 30-Year Fixed Rate Mortgage Average
      fetch(
        `${FRED_BASE}?series_id=MORTGAGE30US&api_key=${fredKey}&file_type=json&sort_order=desc&limit=1`,
        { next: { revalidate: 86400 } }
      ).catch(() => null),
      // MORTGAGE15US: 15-Year Fixed Rate Mortgage Average
      fetch(
        `${FRED_BASE}?series_id=MORTGAGE15US&api_key=${fredKey}&file_type=json&sort_order=desc&limit=1`,
        { next: { revalidate: 86400 } }
      ).catch(() => null),
    ])

    let mortgage30yr = 0.065 // fallback
    let mortgage15yr = 0.058 // fallback

    if (rate30Res?.ok) {
      const data = await rate30Res.json()
      const val = data.observations?.[0]?.value
      if (val && val !== '.') mortgage30yr = parseFloat(val) / 100
    }

    if (rate15Res?.ok) {
      const data = await rate15Res.json()
      const val = data.observations?.[0]?.value
      if (val && val !== '.') mortgage15yr = parseFloat(val) / 100
    }

    return {
      fedFundsRate: 0.0450,        // Approximate April 2026
      treasuryYield10yr: 0.0420,   // Approximate
      mortgage30yr: Math.round(mortgage30yr * 10000) / 10000,
      mortgage15yr: Math.round(mortgage15yr * 10000) / 10000,
    }
  } catch {
    // Fallback to approximate April 2026 rates
    return {
      fedFundsRate: 0.0450,
      treasuryYield10yr: 0.0420,
      mortgage30yr: 0.0650,
      mortgage15yr: 0.0580,
    }
  }
}
