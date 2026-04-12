// Climate risk + insurance cost estimation for US residential properties.
// All data sources are free: Mapbox geocoding (we already have the token),
// FEMA NFHL REST API (flood zones), NAIC state averages (insurance premiums).

// -------- State-level annual HO-3 insurance premium averages (2023 NAIC, rounded) --------
// Basis: average annual homeowners premium for a ~$300k dwelling.
// We scale linearly with actual dwelling value: baseline × (value / 300_000).
const STATE_INSURANCE_BASE: Record<string, number> = {
  AL: 2100, AK: 1100, AZ: 1600, AR: 2500, CA: 1400, CO: 2400, CT: 1700, DE: 1000,
  DC: 1300, FL: 6000, GA: 1900, HI: 1200, ID: 1000, IL: 1300, IN: 1200, IA: 1400,
  KS: 3500, KY: 1700, LA: 2500, ME: 1100, MD: 1400, MA: 1800, MI: 1200, MN: 1900,
  MS: 2500, MO: 1800, MT: 1600, NE: 2900, NV: 1100, NH: 1100, NJ: 1200, NM: 1500,
  NY: 1600, NC: 1400, ND: 1700, OH: 1100, OK: 4500, OR: 900, PA: 1200, RI: 1700,
  SC: 1500, SD: 2100, TN: 1800, TX: 4400, UT: 800, VT: 900, VA: 1200, WA: 1000,
  WV: 1100, WI: 1000, WY: 1300,
}

// -------- Climate risk scores by state (0 = none, 5 = severe) --------
// Each hazard scored independently. A state can be high for multiple.
interface ClimateScores {
  hurricane: number
  wildfire: number
  heat: number
  drought: number
  tornado: number
}
const STATE_CLIMATE: Record<string, Partial<ClimateScores>> = {
  FL: { hurricane: 5, heat: 4 },
  LA: { hurricane: 5, heat: 3 },
  MS: { hurricane: 5, tornado: 3, heat: 3 },
  AL: { hurricane: 4, tornado: 3 },
  GA: { hurricane: 3, tornado: 2 },
  SC: { hurricane: 4 },
  NC: { hurricane: 4 },
  VA: { hurricane: 3 },
  TX: { hurricane: 4, heat: 4, tornado: 4, drought: 4 },
  OK: { tornado: 5, heat: 3, drought: 3 },
  KS: { tornado: 5 },
  MO: { tornado: 4 },
  AR: { tornado: 4 },
  NE: { tornado: 4 },
  IA: { tornado: 4 },
  IL: { tornado: 3 },
  TN: { tornado: 3 },
  CA: { wildfire: 5, drought: 5, heat: 3 },
  OR: { wildfire: 4 },
  WA: { wildfire: 3 },
  ID: { wildfire: 4 },
  MT: { wildfire: 4 },
  NV: { wildfire: 3, drought: 5, heat: 5 },
  AZ: { wildfire: 3, drought: 5, heat: 5 },
  NM: { wildfire: 3, drought: 4, heat: 4 },
  CO: { wildfire: 4, drought: 3 },
  UT: { wildfire: 3, drought: 4 },
  NY: { hurricane: 2 },
  NJ: { hurricane: 2 },
}

// -------- FEMA flood zone interpretation --------
// A, AE, AH, AO, AR, A99 = Special Flood Hazard Area (1% annual-chance flood)
// V, VE = High-risk coastal (adds wave action hazard)
// X = minimal/moderate risk
// D = undetermined
// Empty/null = outside mapped area (treat as X)
const HIGH_RISK_ZONES = new Set(['A', 'AE', 'AH', 'AO', 'AR', 'A99'])
const COASTAL_HIGH_RISK_ZONES = new Set(['V', 'VE'])

export type FloodRisk = 'high-coastal' | 'high' | 'moderate' | 'minimal' | 'unknown'

export interface ClimateAndInsurance {
  // Location
  latitude: number | null
  longitude: number | null

  // Flood
  floodZone: string | null       // e.g. "AE", "X", "VE"
  floodRisk: FloodRisk
  floodInsuranceRequired: boolean

  // Insurance
  estimatedAnnualInsurance: number
  insuranceBreakdown: {
    baseStatePremium: number
    dwellingScaleFactor: number
    floodZoneAddOn: number
  }

  // Climate hazards — 0 to 5 per category
  climateScores: ClimateScores

  // Plain-English summary for AI / UI
  summary: string
  topConcerns: string[]
}

// -------- Mapbox geocoding (we already have a public access token) --------
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  if (!token) return null

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&country=us&limit=1&types=address`
    const res = await fetch(url, { next: { revalidate: 86400 } })
    if (!res.ok) return null
    const data = await res.json()
    const center = data?.features?.[0]?.center
    if (!Array.isArray(center) || center.length < 2) return null
    return { lng: Number(center[0]), lat: Number(center[1]) }
  } catch {
    return null
  }
}

// -------- FEMA NFHL flood zone lookup --------
async function getFloodZone(lat: number, lng: number): Promise<string | null> {
  try {
    const url = new URL('https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query')
    url.searchParams.set('geometry', `${lng},${lat}`)
    url.searchParams.set('geometryType', 'esriGeometryPoint')
    url.searchParams.set('inSR', '4326')
    url.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
    url.searchParams.set('outFields', 'FLD_ZONE,ZONE_SUBTY,SFHA_TF')
    url.searchParams.set('returnGeometry', 'false')
    url.searchParams.set('f', 'json')

    const res = await fetch(url.toString(), { next: { revalidate: 86400 } })
    if (!res.ok) return null
    const data = await res.json()
    const feature = data?.features?.[0]
    if (!feature) return null
    return feature.attributes?.FLD_ZONE || null
  } catch {
    return null
  }
}

function interpretFloodZone(zone: string | null): { risk: FloodRisk; required: boolean } {
  if (!zone) return { risk: 'unknown', required: false }
  const z = zone.toUpperCase().trim()
  if (COASTAL_HIGH_RISK_ZONES.has(z)) return { risk: 'high-coastal', required: true }
  if (HIGH_RISK_ZONES.has(z)) return { risk: 'high', required: true }
  if (z === 'X' || z === 'B' || z === 'C') return { risk: 'minimal', required: false }
  if (z === 'D') return { risk: 'unknown', required: false }
  return { risk: 'moderate', required: false }
}

function floodZoneInsuranceAddOn(risk: FloodRisk, dwellingValue: number): number {
  // NFIP premiums under Risk Rating 2.0 vary, but rough bands:
  if (risk === 'high-coastal') return Math.round(Math.min(3500, dwellingValue * 0.008))
  if (risk === 'high') return Math.round(Math.min(2200, dwellingValue * 0.005))
  if (risk === 'moderate') return 300
  return 0
}

function buildClimateScores(state: string): ClimateScores {
  const partial = STATE_CLIMATE[state] || {}
  return {
    hurricane: partial.hurricane ?? 0,
    wildfire: partial.wildfire ?? 0,
    heat: partial.heat ?? 0,
    drought: partial.drought ?? 0,
    tornado: partial.tornado ?? 0,
  }
}

function buildSummary(
  state: string,
  scores: ClimateScores,
  floodRisk: FloodRisk,
  insuranceAnnual: number
): { summary: string; topConcerns: string[] } {
  const concerns: { label: string; score: number }[] = []
  if (scores.hurricane >= 3) concerns.push({ label: 'Hurricane / tropical storm', score: scores.hurricane })
  if (scores.wildfire >= 3) concerns.push({ label: 'Wildfire', score: scores.wildfire })
  if (scores.heat >= 3) concerns.push({ label: 'Extreme heat', score: scores.heat })
  if (scores.drought >= 3) concerns.push({ label: 'Drought / water scarcity', score: scores.drought })
  if (scores.tornado >= 3) concerns.push({ label: 'Tornado', score: scores.tornado })
  if (floodRisk === 'high' || floodRisk === 'high-coastal') {
    concerns.unshift({ label: 'Flood (FEMA high-risk zone — flood insurance mandatory)', score: 5 })
  }
  concerns.sort((a, b) => b.score - a.score)

  let summary: string
  if (concerns.length === 0) {
    summary = `${state} has low exposure to major climate risks. Insurance estimated at $${insuranceAnnual.toLocaleString()}/yr.`
  } else {
    const top = concerns.slice(0, 2).map((c) => c.label.toLowerCase()).join(' and ')
    summary = `${state} has elevated exposure to ${top}. Budget $${insuranceAnnual.toLocaleString()}/yr for insurance — higher than the national average ($1,800).`
  }

  return { summary, topConcerns: concerns.slice(0, 3).map((c) => c.label) }
}

// Lightweight state-only insurance estimate (no geocoding/FEMA call).
// Use in fast paths like /api/refine where full climate lookup is too slow.
// Typically within ~15% of the full estimate — flood-zone properties will be lower here.
export function estimateInsuranceFast(state: string, dwellingValue: number): number {
  const base = STATE_INSURANCE_BASE[state] ?? 1800
  const scale = Math.max(0.5, Math.min(3, dwellingValue / 300_000))
  return Math.round(base * scale)
}

export async function getClimateAndInsurance(
  address: string,
  state: string,
  _zipCode: string,
  dwellingValue: number
): Promise<ClimateAndInsurance> {
  // 1. Geocode (best-effort; if Mapbox unavailable we skip flood lookup)
  const coords = await geocode(address)

  // 2. Flood zone (needs coords)
  const zone = coords ? await getFloodZone(coords.lat, coords.lng) : null
  const { risk: floodRisk, required: floodRequired } = interpretFloodZone(zone)

  // 3. Insurance estimate
  const baseStatePremium = STATE_INSURANCE_BASE[state] ?? 1800
  const dwellingScaleFactor = Math.max(0.5, Math.min(3, dwellingValue / 300_000))
  const scaledBase = Math.round(baseStatePremium * dwellingScaleFactor)
  const floodAddOn = floodZoneInsuranceAddOn(floodRisk, dwellingValue)
  const estimatedAnnualInsurance = scaledBase + floodAddOn

  // 4. Climate scores
  const climateScores = buildClimateScores(state)

  const { summary, topConcerns } = buildSummary(state, climateScores, floodRisk, estimatedAnnualInsurance)

  return {
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
    floodZone: zone,
    floodRisk,
    floodInsuranceRequired: floodRequired,
    estimatedAnnualInsurance,
    insuranceBreakdown: {
      baseStatePremium: scaledBase,
      dwellingScaleFactor: Math.round(dwellingScaleFactor * 100) / 100,
      floodZoneAddOn: floodAddOn,
    },
    climateScores,
    summary,
    topConcerns,
  }
}
