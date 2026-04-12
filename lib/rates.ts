// US rate data — FRED API (Federal Reserve Economic Data) is free
// No API key required for basic observations

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'

export interface CurrentRates {
  fedFundsRate: number         // Federal funds rate
  treasuryYield10yr: number    // 10-year Treasury yield
  mortgage30yr: number         // Freddie Mac 30-year fixed average
  mortgage15yr: number         // Freddie Mac 15-year fixed average
}

export async function getCurrentRates(): Promise<CurrentRates> {
  try {
    // FRED requires an API key but we'll use their public data feed
    // For MVP, fetch from the Freddie Mac survey data
    const [rate30Res, rate15Res] = await Promise.all([
      // MORTGAGE30US: 30-Year Fixed Rate Mortgage Average
      fetch(
        `${FRED_BASE}?series_id=MORTGAGE30US&api_key=DEMO_KEY&file_type=json&sort_order=desc&limit=1`,
        { next: { revalidate: 86400 } }
      ).catch(() => null),
      // MORTGAGE15US: 15-Year Fixed Rate Mortgage Average
      fetch(
        `${FRED_BASE}?series_id=MORTGAGE15US&api_key=DEMO_KEY&file_type=json&sort_order=desc&limit=1`,
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
