// US Property Data API wrapper
// Supports multiple providers — configure via PROPERTY_API_PROVIDER env var
// Default: stub data for MVP. Swap to Rentcast, ATTOM, or RealtyMole for production.

const API_KEY = process.env.PROPERTY_API_KEY || ''

export interface PropertyData {
  property_id: string
  address: string
  city: string
  state: string
  zip_code: string
  bedrooms: number
  bathrooms: number
  property_type: string
  estimated_value: number
  year_built: number
  square_feet: number
  lot_size?: number
  // Coordinates from Rentcast — used for address-adjacent comp search + climate
  latitude?: number
  longitude?: number
  // Optional county-record fields — present when Rentcast has them
  annual_property_tax?: number     // actual most-recent-year tax (not state avg × price)
  hoa_fee_monthly?: number         // monthly HOA dues if captured
  // Value attribution — so the UI can show buyers where the number came from
  // and what the confidence range looks like. Critical for AVM-based reports.
  value_source?: 'avm' | 'listing' | 'tax-assessment' | 'last-sale-grown' | 'unknown'
  value_range_low?: number
  value_range_high?: number
  last_sale_price?: number
  last_sale_date?: string | null
  latest_tax_assessment?: number   // most-recent assessed value
  // Zoning / classification hints — flag properties where rent AVMs are unreliable
  // (student rentals leased per-room, multi-unit, etc.)
  zoning?: string
  subdivision?: string
  // 'full' when /properties returned a record for this address. 'avm-only' when
  // /properties 404'd and we had to synthesize bed/bath/sqft/type from AVM
  // comparables — triggers a data-quality warning in the report.
  data_completeness?: 'full' | 'avm-only'
  // Count of comps Rentcast's AVM used internally (not our own getComparableSales
  // result). Surfaced in the confidence-band warning so users can tell a
  // 4-comp $214-317k band apart from a 20-comp one.
  avm_comparables_count?: number
}

export interface RentEstimate {
  estimated_rent: number
  rent_low: number
  rent_high: number
}

export interface RentComp {
  address: string
  bedrooms?: number
  bathrooms?: number
  square_feet?: number
  rent: number
  distance_miles?: number
  days_old?: number
}

// Search for property by address string.
// In production (API key configured) we return null on miss — the caller surfaces
// a real "property not found" error. Stub data is dev-mode only (no API key set)
// so we never charge a user for a report synthesized from random numbers.
//
// Quota / rate-limit errors from Rentcast bubble up as RentcastQuotaError so
// the preview route can show a specific "data service over quota — try later"
// message instead of the misleading "property not found."
export async function searchProperty(address: string): Promise<PropertyData | null> {
  if (API_KEY && API_KEY !== 'your_key_here') {
    return await searchPropertyRentcast(address)
  }
  return generateStubProperty(address)
}

// Custom error thrown when Rentcast rejects the API key or quota is exhausted.
// Caught by the preview route and surfaced to the user with a specific
// "data service unavailable" message instead of the generic "not found."
export class RentcastQuotaError extends Error {
  constructor(public status: number) {
    super(`Rentcast API ${status}: auth or quota failure`)
    this.name = 'RentcastQuotaError'
  }
}

// --- Address match classification ---
//
// Rentcast sometimes silently substitutes a nearby but DIFFERENT property when
// the user's typed address has a minor variant it doesn't recognise —
// "408 S 8th St, Saginaw MI" returned a record for "408 N 8th St". Numbers and
// street names match; only the cardinal direction flipped. The report then
// generated on the wrong house. We classify match quality so the preview route
// can block this before the user pays.

function normalizeStreetSuffix(tok: string): string {
  const map: Record<string, string> = {
    street: 'st', str: 'st',
    avenue: 'ave', av: 'ave',
    boulevard: 'blvd', boul: 'blvd',
    road: 'rd',
    drive: 'dr',
    lane: 'ln',
    court: 'ct',
    place: 'pl',
    terrace: 'ter',
    highway: 'hwy',
    parkway: 'pkwy',
    circle: 'cir',
    trail: 'trl',
  }
  return map[tok] ?? tok
}

function normalizeCardinal(tok: string): string {
  const map: Record<string, string> = {
    north: 'n', south: 's', east: 'e', west: 'w',
    ne: 'ne', nw: 'nw', se: 'se', sw: 'sw',
    northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  }
  return map[tok] ?? tok
}

export interface AddressParts {
  number: string | null
  direction: string | null        // 'n' | 's' | 'e' | 'w' | 'ne' | ... | null
  streetCore: string[]            // street name tokens minus direction + suffix
  streetSuffix: string | null     // normalized ('st', 'ave', ...)
  city: string | null
  state: string | null
  zip: string | null
}

export function parseAddressParts(input: string): AddressParts {
  const cleaned = String(input || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Split on commas first to isolate city / state-zip if present. But we
  // already stripped commas → use a different approach: tokens + positional.
  // Actually: work from the original (pre-strip) form for comma-based split.
  const rawCommaSplit = String(input || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim().replace(/[.]/g, ''))
    .filter((s) => s.length > 0)

  // rawCommaSplit[0] = street; [1] = city; [2] = "state zip"
  // Strip unit markers that attach to the street without a comma, e.g.
  // "1330 New Hampshire Ave NW #1002" or "... Apt 516" — otherwise they
  // land in streetCore and break building-key equality across units.
  const streetPart = (rawCommaSplit[0] ?? cleaned)
    .replace(/\s+(apt|unit|ste|suite)\s*\S+$/i, '')
    .replace(/\s+#\s*\S+$/i, '')
  const cityPart = rawCommaSplit[1] ?? null
  const stateZipPart = rawCommaSplit[2] ?? null

  const CARDINALS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'])
  const SUFFIXES = new Set(['st', 'street', 'str', 'ave', 'avenue', 'av', 'blvd', 'boulevard', 'boul', 'rd', 'road', 'dr', 'drive', 'ln', 'lane', 'ct', 'court', 'pl', 'place', 'ter', 'terrace', 'hwy', 'highway', 'pkwy', 'parkway', 'cir', 'circle', 'trl', 'trail', 'way'])

  const toks = streetPart.split(/\s+/).filter(Boolean)
  let number: string | null = null
  let direction: string | null = null
  let streetSuffix: string | null = null
  const streetCore: string[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (i === 0 && /^\d+$/.test(t)) { number = t; continue }
    if (!direction && CARDINALS.has(t)) { direction = normalizeCardinal(t); continue }
    if (SUFFIXES.has(t) && i > 0) { streetSuffix = normalizeStreetSuffix(t); continue }
    streetCore.push(t)
  }

  let state: string | null = null
  let zip: string | null = null
  if (stateZipPart) {
    const m = stateZipPart.match(/([a-z]{2})\s*(\d{5})?/i)
    if (m) {
      state = m[1].toLowerCase()
      zip = m[2] ?? null
    }
  }

  return {
    number,
    direction,
    streetCore,
    streetSuffix,
    city: cityPart,
    state,
    zip,
  }
}

/**
 * Extract a "building key" — street number + normalized core street tokens —
 * from an address. Two addresses with the same building key are unit-level
 * peers in the same building. Used to prefer same-building sale comps over
 * neighborhood comps when the subject is a condo / apartment.
 *
 * Returns null when the address lacks a number or a street name.
 */
export function buildingKey(address: string): string | null {
  const p = parseAddressParts(address)
  if (!p.number) return null
  if (p.streetCore.length === 0) return null
  const dir = p.direction ? `${p.direction} ` : ''
  return `${p.number} ${dir}${p.streetCore.join(' ')}`.trim().toLowerCase()
}

// Returns true when an address carries a unit marker indicating it's a
// specific apartment/condo unit within a multi-unit building — e.g.
// "414 Water St #1501", "1300 Main St Apt 4B", "500 Elm St Unit 201".
// Used as a secondary signal for condo-like comp filtering when Rentcast's
// propertyType field is missing or ambiguous.
export function isUnitLikeAddress(address: string): boolean {
  if (!address) return false
  return /(?:^|[\s,])(?:#\s*\w|apt\b|unit\b|suite\b|ste\b)/i.test(address)
}

export type AddressMatchKind = 'exact' | 'soft' | 'hard-mismatch'
export interface AddressMatchReport {
  kind: AddressMatchKind
  mismatches: string[]     // list of field names that diverged
}

/**
 * Compare a user-typed address against Rentcast's resolved formattedAddress.
 * Returns 'hard-mismatch' when the street number, direction, core street
 * tokens, or zip differ — these almost certainly mean a different property.
 * Returns 'soft' for purely cosmetic differences (suffix spelling, missing
 * zip, casing). 'exact' when everything material matches.
 *
 * 'soft' still generates the report; 'hard-mismatch' should block and ask
 * the user to confirm.
 */
export function classifyAddressMatch(
  userInput: string,
  resolved: string
): AddressMatchReport {
  const u = parseAddressParts(userInput)
  const r = parseAddressParts(resolved)
  const mismatches: string[] = []

  if (u.number && r.number && u.number !== r.number) mismatches.push('number')

  // Direction: only flag when BOTH sides have a direction and they disagree,
  // OR when the user specified one and Rentcast has a different one. If the
  // user omitted direction and Rentcast supplies one, that's a soft case.
  if (u.direction && r.direction && u.direction !== r.direction) {
    mismatches.push('direction')
  }

  // Street core tokens must overlap — require at least one shared non-trivial
  // token when both sides have a core. If no overlap → different street.
  if (u.streetCore.length > 0 && r.streetCore.length > 0) {
    const overlap = u.streetCore.some((t) => r.streetCore.includes(t))
    if (!overlap) mismatches.push('streetName')
  }

  if (u.zip && r.zip && u.zip !== r.zip) mismatches.push('zip')

  // Hard mismatch on any of: number, direction, streetName, zip
  const hardFields = mismatches.filter((m) =>
    ['number', 'direction', 'streetName', 'zip'].includes(m)
  )
  if (hardFields.length > 0) return { kind: 'hard-mismatch', mismatches }

  // Soft: suffix, city, or state differences (cosmetic).
  if (u.streetSuffix && r.streetSuffix && u.streetSuffix !== r.streetSuffix) {
    return { kind: 'soft', mismatches: ['suffix'] }
  }
  return { kind: 'exact', mismatches: [] }
}

function diagnoseRentcastResponse(res: Response): 'ok' | 'quota' | 'rate-limit' | 'error' {
  if (res.ok) return 'ok'
  if (res.status === 401 || res.status === 403) return 'quota'
  if (res.status === 429) return 'rate-limit'
  return 'error'
}

// Rentcast's dedicated value AVM endpoint. Returns a real estimate with a
// confidence band. The property lookup endpoint (/properties) doesn't include
// a price in most responses — you need /avm/value for that.
//
// We also capture subjectProperty (address + coords) and comparables (recent
// sold nearby properties with bed/bath/sqft/type/yearBuilt). When /properties
// 404s for addresses Rentcast doesn't have in its property database but DOES
// have AVM coverage for (412 N Main St, Blacksburg VA was the audit case),
// the comparables let us synthesize a best-effort PropertyData rather than
// give up with "property not found."
interface AvmResult {
  price: number
  low: number
  high: number
  subject?: {
    address?: string
    city?: string
    state?: string
    zipCode?: string
    latitude?: number
    longitude?: number
  }
  comparables?: Array<{
    bedrooms?: number
    bathrooms?: number
    squareFootage?: number
    propertyType?: string
    yearBuilt?: number
  }>
}

async function fetchValueAvm(address: string): Promise<AvmResult | null> {
  try {
    const url = new URL('https://api.rentcast.io/v1/avm/value')
    url.searchParams.set('address', address)
    const res = await fetch(url.toString(), {
      headers: { 'X-Api-Key': API_KEY },
      next: { revalidate: 86_400 }, // 24h cache — property data barely changes day-to-day; dramatically reduces API burn on repeat addresses
    })
    const diag = diagnoseRentcastResponse(res)
    if (diag === 'quota' || diag === 'rate-limit') {
      throw new RentcastQuotaError(res.status)
    }
    if (!res.ok) return null
    const d = await res.json()
    const price = Number(d?.price)
    if (!Number.isFinite(price) || price <= 0) return null
    const sp = d?.subjectProperty
    const comparables = Array.isArray(d?.comparables)
      ? d.comparables.map((c: any) => ({
          bedrooms: Number(c?.bedrooms) || undefined,
          bathrooms: Number(c?.bathrooms) || undefined,
          squareFootage: Number(c?.squareFootage) || undefined,
          propertyType: typeof c?.propertyType === 'string' ? c.propertyType : undefined,
          yearBuilt: Number(c?.yearBuilt) || undefined,
        }))
      : []
    return {
      price,
      low: Number(d?.priceRangeLow) || price,
      high: Number(d?.priceRangeHigh) || price,
      subject: sp
        ? {
            address: sp.formattedAddress || sp.addressLine1,
            city: sp.city,
            state: sp.state,
            zipCode: sp.zipCode,
            latitude: Number(sp.latitude) || undefined,
            longitude: Number(sp.longitude) || undefined,
          }
        : undefined,
      comparables,
    }
  } catch (err) {
    if (err instanceof RentcastQuotaError) throw err // bubble up quota issues
    return null
  }
}

// Build a best-effort PropertyData from AVM data when /properties 404s.
// Bedrooms / bathrooms / sqft / property-type / year-built are inferred from
// the median of nearby comparables — an honest "similar properties look like
// this" estimate. The report surfaces a `property-profile-inferred` warning
// so the user knows these fields aren't direct measurements.
//
// Exported for unit tests; not part of the public API surface.
export function buildPropertyDataFromAvm(
  requestedAddress: string,
  avm: AvmResult
): PropertyData | null {
  if (!avm.subject || !avm.price) return null
  const comps = avm.comparables ?? []

  // Median helper over a finite-positive filtered series.
  const median = (vals: number[]): number | undefined => {
    const clean = vals.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
    if (clean.length === 0) return undefined
    const mid = Math.floor(clean.length / 2)
    return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid]
  }

  // Modal helper — for categorical fields (propertyType).
  const mode = (vals: string[]): string | undefined => {
    const counts: Record<string, number> = {}
    for (const v of vals) counts[v] = (counts[v] ?? 0) + 1
    let best: string | undefined
    let bestN = 0
    for (const v of Object.keys(counts)) {
      if (counts[v] > bestN) { best = v; bestN = counts[v] }
    }
    return best
  }

  const bedrooms = Math.round(median(comps.map((c) => c.bedrooms ?? 0)) ?? 3)
  const bathrooms = median(comps.map((c) => c.bathrooms ?? 0)) ?? 2
  const squareFootage = median(comps.map((c) => c.squareFootage ?? 0))
  const yearBuilt = median(comps.map((c) => c.yearBuilt ?? 0))
  const propertyType =
    mode(comps.map((c) => c.propertyType).filter((v): v is string => !!v)) ??
    'Single Family'

  const addr = avm.subject.address ?? requestedAddress
  return {
    property_id: addr,
    address: addr,
    city: avm.subject.city ?? '',
    state: avm.subject.state ?? '',
    zip_code: avm.subject.zipCode ?? '',
    bedrooms,
    bathrooms: Math.round(bathrooms * 2) / 2, // round to nearest 0.5 like listing data
    property_type: propertyType,
    estimated_value: avm.price,
    year_built: yearBuilt ? Math.round(yearBuilt) : 1970,
    square_feet: squareFootage ? Math.round(squareFootage) : 1500,
    latitude: avm.subject.latitude,
    longitude: avm.subject.longitude,
    value_source: 'avm',
    value_range_low: avm.low,
    value_range_high: avm.high,
    data_completeness: 'avm-only',
    avm_comparables_count: comps.length,
  }
}

// Rentcast API integration
async function searchPropertyRentcast(address: string): Promise<PropertyData | null> {
  try {
    const url = new URL('https://api.rentcast.io/v1/properties')
    url.searchParams.set('address', address)

    // Fire the AVM call in parallel so we don't serialize two Rentcast round-trips
    const [propRes, avm] = await Promise.all([
      fetch(url.toString(), {
        headers: { 'X-Api-Key': API_KEY },
        next: { revalidate: 86_400 }, // 24h cache — property data barely changes day-to-day; dramatically reduces API burn on repeat addresses
      }),
      fetchValueAvm(address),
    ])
    const diag = diagnoseRentcastResponse(propRes)
    if (diag === 'quota' || diag === 'rate-limit') {
      throw new RentcastQuotaError(propRes.status)
    }

    // When /properties returns 404 (common for addresses Rentcast doesn't have
    // in its property DB but DOES have AVM coverage for — Blacksburg VA and
    // other smaller markets), fall back to building a profile from the AVM
    // response + comparables rather than giving up with "property not found."
    if (!propRes.ok) {
      if (propRes.status === 404 && avm) {
        return buildPropertyDataFromAvm(address, avm)
      }
      return null
    }

    const data = await propRes.json()
    if (!data || (Array.isArray(data) && data.length === 0)) {
      // /properties returned 200 but empty → same AVM fallback path
      if (avm) return buildPropertyDataFromAvm(address, avm)
      return null
    }

    const prop = Array.isArray(data) ? data[0] : data

    // Pull most-recent-year property tax if Rentcast returns county records.
    // Shape: propertyTaxes = { "2024": { total: 8421 }, "2023": {...}, ... }
    let annualPropertyTax: number | undefined
    if (prop.propertyTaxes && typeof prop.propertyTaxes === 'object') {
      const years = Object.keys(prop.propertyTaxes).sort().reverse()
      for (const y of years) {
        const t = prop.propertyTaxes[y]?.total
        if (typeof t === 'number' && t > 0) { annualPropertyTax = t; break }
      }
    }

    // HOA capture when available. Rentcast shape varies; handle the common forms.
    let hoaMonthly: number | undefined
    if (prop.hoa && typeof prop.hoa === 'object') {
      const fee = Number(prop.hoa.fee)
      if (Number.isFinite(fee) && fee > 0) {
        const freq = (prop.hoa.frequency || 'monthly').toString().toLowerCase()
        hoaMonthly =
          freq.includes('year') || freq.includes('annual') ? Math.round(fee / 12) :
          freq.includes('quarter') ? Math.round(fee / 3) :
          Math.round(fee)
      }
    }

    // Value cascade — use the best signal we have, tagged with its source so
    // the UI can show buyers where the number came from + confidence band.
    // NEVER silently fall back to a magic $350k placeholder (previous bug).
    let estimatedValue = 0
    let valueSource: PropertyData['value_source'] = 'unknown'
    let valueRangeLow: number | undefined
    let valueRangeHigh: number | undefined

    // Priority 1: active listing price if present
    if (prop.price && Number(prop.price) > 0) {
      estimatedValue = Number(prop.price)
      valueSource = 'listing'
    }
    // Priority 2: Rentcast value AVM (with confidence range)
    else if (avm) {
      estimatedValue = avm.price
      valueSource = 'avm'
      valueRangeLow = avm.low
      valueRangeHigh = avm.high
    }
    // Priority 3: most-recent tax assessment × 1.15 (assessments typically
    // lag market by ~15% in fair-market areas; varies by state but better
    // than nothing)
    else if (prop.taxAssessments) {
      const years = Object.keys(prop.taxAssessments).sort().reverse()
      for (const y of years) {
        const v = Number(prop.taxAssessments[y]?.value)
        if (Number.isFinite(v) && v > 0) {
          estimatedValue = Math.round(v * 1.15)
          valueSource = 'tax-assessment'
          break
        }
      }
    }
    // Priority 4: last sale price grown at 3%/yr since sale date
    if (!estimatedValue && prop.lastSalePrice && prop.lastSaleDate) {
      const saleYear = new Date(prop.lastSaleDate).getFullYear()
      const currentYear = new Date().getFullYear()
      const years = Math.max(0, currentYear - saleYear)
      estimatedValue = Math.round(Number(prop.lastSalePrice) * Math.pow(1.03, years))
      valueSource = 'last-sale-grown'
    }

    // If we genuinely have no value signal, return null — caller surfaces
    // a real "property not found" error rather than a fabricated report.
    if (!estimatedValue || estimatedValue <= 0) return null

    // Capture latest tax assessment for UI display even if not the chosen value
    let latestTaxAssessment: number | undefined
    if (prop.taxAssessments && typeof prop.taxAssessments === 'object') {
      const years = Object.keys(prop.taxAssessments).sort().reverse()
      for (const y of years) {
        const v = Number(prop.taxAssessments[y]?.value)
        if (Number.isFinite(v) && v > 0) { latestTaxAssessment = v; break }
      }
    }

    return {
      property_id: prop.id || prop.addressHash || address,
      address: prop.formattedAddress || prop.addressLine1 || address.split(',')[0],
      city: prop.city || '',
      state: prop.state || '',
      zip_code: prop.zipCode || '',
      // `|| 3` was silently upgrading studios (Rentcast returns 0) to 3BR,
      // which cascaded into wrong comp matching + wrong rent AVM. Preserve
      // a numeric 0, fall back only for null/undefined.
      bedrooms: typeof prop.bedrooms === 'number' ? prop.bedrooms : 3,
      bathrooms: typeof prop.bathrooms === 'number' ? prop.bathrooms : 2,
      property_type: prop.propertyType || 'Single Family',
      estimated_value: estimatedValue,
      year_built: prop.yearBuilt || 2000,
      square_feet: prop.squareFootage || 1800,
      lot_size: prop.lotSize,
      latitude: typeof prop.latitude === 'number' ? prop.latitude : undefined,
      longitude: typeof prop.longitude === 'number' ? prop.longitude : undefined,
      annual_property_tax: annualPropertyTax,
      hoa_fee_monthly: hoaMonthly,
      value_source: valueSource,
      value_range_low: valueRangeLow,
      value_range_high: valueRangeHigh,
      last_sale_price: prop.lastSalePrice ? Number(prop.lastSalePrice) : undefined,
      last_sale_date: prop.lastSaleDate || null,
      latest_tax_assessment: latestTaxAssessment,
      zoning: typeof prop.zoning === 'string' ? prop.zoning : undefined,
      subdivision: typeof prop.subdivision === 'string' ? prop.subdivision : undefined,
      data_completeness: 'full',
      avm_comparables_count: avm?.comparables?.length,
    }
  } catch (err) {
    if (err instanceof RentcastQuotaError) throw err
    return null
  }
}

// Zip-level market statistics — used for the "Local Market Snapshot" section.
// Rentcast returns current + historical medians so we can show a 12-month growth
// trend. If the endpoint isn't available on our plan, return null and the UI
// hides the whole section (we never show fake market data).
export interface MarketSnapshot {
  zipCode: string
  salePriceMedian: number | null
  rentMedian: number | null
  pricePerSqft: number | null
  rentPerSqft: number | null
  avgDaysOnMarket: number | null
  salePriceGrowth12mo: number | null // decimal, e.g. 0.052 = +5.2%
  rentGrowth12mo: number | null
}

export async function getMarketSnapshot(zipCode: string): Promise<MarketSnapshot | null> {
  if (!API_KEY || API_KEY === 'your_key_here' || !zipCode) return null
  try {
    const url = new URL('https://api.rentcast.io/v1/markets')
    url.searchParams.set('zipCode', zipCode)
    url.searchParams.set('historyRange', '12')
    url.searchParams.set('dataType', 'All')

    const res = await fetch(url.toString(), {
      headers: { 'X-Api-Key': API_KEY },
      next: { revalidate: 604_800 }, // 7d — market stats move slowly at the zip level
    })
    if (!res.ok) return null
    const data = await res.json()

    // Prefer MEDIAN over AVERAGE — luxury outliers in urban zips (e.g. a
    // $4M penthouse in 20037) drag the average to ~$1M while the real
    // median condo sale is $650-700K. Median is a far better anchor for
    // the "typical" buyer's expectation. Falls back to average only when
    // median isn't available.
    const saleNow =
      data?.saleData?.medianPrice ?? data?.saleData?.averagePrice ?? null
    const rentNow =
      data?.rentalData?.medianRent ?? data?.rentalData?.averageRent ?? null

    // Find the oldest point in the history window (12 months back)
    const saleHistory = data?.saleData?.history ?? {}
    const rentHistory = data?.rentalData?.history ?? {}
    const oldestSaleKey = Object.keys(saleHistory).sort()[0]
    const oldestRentKey = Object.keys(rentHistory).sort()[0]
    const saleThen =
      oldestSaleKey
        ? saleHistory[oldestSaleKey]?.medianPrice ?? saleHistory[oldestSaleKey]?.averagePrice
        : null
    const rentThen =
      oldestRentKey
        ? rentHistory[oldestRentKey]?.medianRent ?? rentHistory[oldestRentKey]?.averageRent
        : null

    const growth = (now: number | null, then: number | null): number | null =>
      now && then && then > 0
        ? Math.round(((now - then) / then) * 10000) / 10000
        : null

    // ZIP-level rentGrowth from Rentcast is a small-sample series and can
    // spike to -8% / +15% on thin inventory while Zillow ZORI / Redfin
    // metro-wide rent indexes for the same footprint read -2% to -4%. Clamp
    // to a sane band so the 5-year projection doesn't compound noise; cap
    // salePriceGrowth similarly (median sale growth at the zip level is
    // likewise noisy when only a handful of closings print in a quarter).
    const clamp = (v: number | null, lo: number, hi: number): number | null =>
      v == null ? null : Math.max(lo, Math.min(hi, v))

    return {
      zipCode,
      salePriceMedian: saleNow,
      rentMedian: rentNow,
      pricePerSqft:
        data?.saleData?.medianPricePerSquareFoot ??
        data?.saleData?.averagePricePerSquareFoot ?? null,
      rentPerSqft:
        data?.rentalData?.medianRentPerSquareFoot ??
        data?.rentalData?.averageRentPerSquareFoot ?? null,
      avgDaysOnMarket: data?.saleData?.averageDaysOnMarket ?? null,
      salePriceGrowth12mo: clamp(growth(saleNow, saleThen), -0.15, 0.25),
      rentGrowth12mo: clamp(growth(rentNow, rentThen), -0.04, 0.15),
    }
  } catch {
    return null
  }
}

// Rent comparables — separate function because we only need them for the paid
// full report, not the pre-paywall teaser. Keeps preview fast. propertyType
// narrows the AVM's own comp pool so a townhouse isn't priced against SFRs.
export async function getRentComps(
  address: string,
  bedrooms: number,
  propertyType?: string | null
): Promise<RentComp[]> {
  if (!API_KEY || API_KEY === 'your_key_here') return []
  try {
    const url = new URL('https://api.rentcast.io/v1/avm/rent/long-term')
    url.searchParams.set('address', address)
    url.searchParams.set('bedrooms', String(bedrooms))
    url.searchParams.set('compCount', '5')
    if (propertyType) {
      url.searchParams.set('propertyType', propertyType)
    }

    const res = await fetch(url.toString(), {
      headers: { 'X-Api-Key': API_KEY },
      next: { revalidate: 86_400 }, // 24h cache — property data barely changes day-to-day; dramatically reduces API burn on repeat addresses
    })
    if (!res.ok) return []
    const data = await res.json()
    const comps = Array.isArray(data?.comparables) ? data.comparables : []
    const mapped: RentComp[] = comps
      .map((c: any): RentComp => ({
        address: c.formattedAddress || c.addressLine1 || '',
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        square_feet: c.squareFootage,
        rent: Number(c.price ?? c.rent ?? 0),
        distance_miles: c.distance,
        days_old: c.daysOld,
      }))
      .filter((c: RentComp) => c.rent > 0 && c.address)

    // Outlier filter — drop rent comps whose $/sqft is more than 1.25× the
    // set median (previously 1.5×). Real-world miss: a 525-sqft unit listed
    // at $2,995 (5.70 $/sqft) passed 1.5× against a ~4.00 $/sqft median
    // (1.42×). Likely a furnished / short-term / mis-classified listing;
    // 1.25× is close to the expected dispersion inside a real studio comp
    // pool while catching clear furnished outliers.
    const rates = mapped
      .map((c) => (c.rent && c.square_feet ? c.rent / c.square_feet : null))
      .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b)
    const medianRate =
      rates.length > 0 ? rates[Math.floor(rates.length / 2)] : null

    // Staleness filter — drop comps older than 60 days when we have
    // fresher alternatives. A 89-day-old listing at $1,650 dragged the
    // Jefferson House median below current $1,900-2,100 actives.
    const freshCount = mapped.filter(
      (c) => c.days_old == null || c.days_old <= 60
    ).length

    const filtered = mapped.filter((c) => {
      if (medianRate && c.rent && c.square_feet) {
        const rate = c.rent / c.square_feet
        if (rate > medianRate * 1.25) return false
      }
      if (freshCount >= 3 && c.days_old != null && c.days_old > 60) return false
      return true
    })

    // Same-building rent comps are the strongest anchor for condo rent —
    // same floor plan, same amenities, same HOA-bundled utilities — so
    // surface them first when present. Jefferson House (922 24th St NW)
    // audit: studios list $1,495–$2,100 in-building while Rentcast was
    // returning 1101 New Hampshire / 940 25th St as the top comps.
    const subjectBuildingKey = buildingKey(address)
    if (subjectBuildingKey) {
      filtered.sort((a, b) => {
        const aSame = buildingKey(a.address) === subjectBuildingKey ? 1 : 0
        const bSame = buildingKey(b.address) === subjectBuildingKey ? 1 : 0
        return bSame - aSame
      })
    }

    return filtered.slice(0, 5)
  } catch {
    return []
  }
}

// Get rent estimate for a property
export async function getRentEstimate(address: string, bedrooms: number): Promise<RentEstimate | null> {
  if (API_KEY && API_KEY !== 'your_key_here') {
    try {
      const url = new URL('https://api.rentcast.io/v1/avm/rent/long-term')
      url.searchParams.set('address', address)

      const res = await fetch(url.toString(), {
        headers: { 'X-Api-Key': API_KEY },
        next: { revalidate: 86_400 }, // 24h cache — property data barely changes day-to-day; dramatically reduces API burn on repeat addresses
      })
      if (!res.ok) return null

      const data = await res.json()
      const rent = data.rent ?? data.rentRangeLow
      if (!rent) return null
      return {
        estimated_rent: rent,
        rent_low: data.rentRangeLow ?? rent,
        rent_high: data.rentRangeHigh ?? rent,
      }
    } catch {
      return null
    }
  }

  // Stub estimate based on bedrooms (dev mode only — no API key)
  const baseRent = 1200 + bedrooms * 300
  return {
    estimated_rent: baseRent,
    rent_low: Math.round(baseRent * 0.85),
    rent_high: Math.round(baseRent * 1.15),
  }
}

// Get comparable sales in area. If lat/lng are provided, we filter by radius
// around the subject property (much more useful than city-wide bedroom-median).
// Falls back to city+bedroom when coordinates aren't available.
//
// `subject` — the subject property's sqft + estimated value + propertyType.
// Used to filter out non-residential Rentcast records that otherwise poison
// the comp median: parking spaces, storage units, boat slips, tax-auction
// outcomes, and assessor-only records with nonsense prices (we saw a $21,500
// median once for a $275k high-rise condo because the API returned a parking
// deed). propertyType narrows the Rentcast query upstream so SFR detached
// homes don't land in a townhouse/condo comp set (Phoenix 15671 N 29th St
// caught: $460k SFR median on a $300k townhouse).
export async function getComparableSales(
  city: string,
  state: string,
  bedrooms: number,
  coords?: { lat: number; lng: number } | null,
  radiusMiles: number = 1.0,
  subject?: {
    sqft?: number | null
    value?: number | null
    propertyType?: string | null
    address?: string | null       // used to identify same-building comps
  } | null
) {
  if (API_KEY && API_KEY !== 'your_key_here') {
    try {
      const url = new URL('https://api.rentcast.io/v1/properties')
      if (coords) {
        url.searchParams.set('latitude', String(coords.lat))
        url.searchParams.set('longitude', String(coords.lng))
        url.searchParams.set('radius', String(radiusMiles))
      } else {
        url.searchParams.set('city', city)
        url.searchParams.set('state', state)
      }
      url.searchParams.set('bedrooms', bedrooms.toString())
      // Narrow by property type when we know it — avoids pulling SFR detached
      // homes into a townhouse/condo comp set. Rentcast values: "Single Family",
      // "Condo", "Townhouse", "Multi-Family", "Manufactured", "Apartment".
      if (subject?.propertyType) {
        url.searchParams.set('propertyType', subject.propertyType)
      }
      // Request more than we'll show — we're about to filter aggressively
      // AND we want headroom to prefer same-building matches if they exist.
      url.searchParams.set('limit', '40')
      url.searchParams.set('status', 'Sold')

      const res = await fetch(url.toString(), {
        headers: { 'X-Api-Key': API_KEY },
        next: { revalidate: 86_400 }, // 24h cache — property data barely changes day-to-day; dramatically reduces API burn on repeat addresses
      })
      if (!res.ok) return []

      const data = await res.json()
      const subjectSqft = subject?.sqft && subject.sqft > 0 ? subject.sqft : null
      const subjectValue = subject?.value && subject.value > 0 ? subject.value : null
      const subjectBuildingKey = subject?.address ? buildingKey(subject.address) : null
      const subjectZip = subject?.address ? parseAddressParts(subject.address).zip : null
      const subjectPtLowerRaw = String(subject?.propertyType || '').toLowerCase()
      const subjectAddrHasUnit = isUnitLikeAddress(subject?.address || '')
      // Treat a subject as condo-like when EITHER propertyType matches OR
      // the address itself carries a unit marker (Apt / # / Unit / Suite).
      // Baltimore 414 Water St #1501 audit: Rentcast occasionally returns a
      // blank propertyType on specific units, bypassing the zip + sqft
      // guards and re-admitting 21230 Ridgley's Delight townhouses.
      const subjectIsCondoLikeRaw =
        /condo|apartment|co-?op|coop/.test(subjectPtLowerRaw) || subjectAddrHasUnit

      const mapped = (Array.isArray(data) ? data : []).map((p: any) => {
        // Rentcast sold records use lastSalePrice; active listings use price;
        // off-market AVM estimates use estimatedValue. Try all three in order.
        const price =
          Number(p.lastSalePrice) ||
          Number(p.price) ||
          Number(p.estimatedValue) ||
          0
        const sqft = Number(p.squareFootage) || 0
        return {
          address: p.formattedAddress || p.addressLine1,
          estimated_value: price,
          bedrooms: p.bedrooms,
          bathrooms: p.bathrooms,
          square_feet: sqft,
          price_per_sqft: sqft > 0 && price > 0 ? Math.round(price / sqft) : null,
          days_on_market: typeof p.daysOnMarket === 'number' ? p.daysOnMarket : null,
          sold_date: p.lastSaleDate || p.soldDate || null,
          propertyType: typeof p.propertyType === 'string' ? p.propertyType : null,
        }
      })

      // Staleness cutoff — drop sold records older than 48 months. A 15-year-
      // old sale from a different building (DC Jefferson House audit: 2011
      // sale at 2030 F St was the only "comp" offered) is actively
      // misleading; better to surface "no recent comps" than to anchor on it.
      const STALE_CUTOFF_MS = Date.now() - 48 * 30 * 24 * 60 * 60 * 1000

      const cleaned = mapped.filter((c: any) => {
        // Commercial / office / mixed-use filter.
        const addr = String(c.address || '')
        if (/\b(ste|suite|office|floor|bldg|building)\b/i.test(addr)) return false
        // Same-building comps bypass the strict sqft/value/type filters
        // below. Jefferson House (922 24th St NW DC) audit: 4 studio sales
        // at $201-249k on the subject building were filtered out because
        // Rentcast's propertyType field was inconsistent across unit
        // records, returning zero sale comps despite the building having
        // real recent sales. Same-building peers are the gold standard
        // anchor — never drop them for filter reasons.
        const compBuildingKey = buildingKey(addr)
        const isSameBuilding =
          !!subjectBuildingKey && !!compBuildingKey && compBuildingKey === subjectBuildingKey
        if (/\bunit\s*#?\s*(\d{3,})/i.test(addr) && !isSameBuilding) return false
        const pt = String(c.propertyType || '').toLowerCase()
        if (!isSameBuilding && pt && !/single family|condo|townhouse|apartment|multi|manufactured/.test(pt)) return false
        // Price floor — filter parking / storage / tax-auction anomalies.
        if (!(c.estimated_value > 30_000)) return false
        if (!isSameBuilding && subjectSqft && (!c.square_feet || c.square_feet < 200)) return false
        if (!isSameBuilding && subjectSqft && c.square_feet) {
          const ratio = c.square_feet / subjectSqft
          // Tighter sqft band for condo-like subjects — a high-rise condo
          // isn't comparable to a townhouse-style unit 50% larger even if
          // both code as "Condo" in Rentcast. Baltimore Harbor East audit:
          // 414 Water St (1067 sqft) was getting 1454–1559 sqft comps from
          // Ridgely's Delight as "Condos" at $440k.
          const [minR, maxR] = subjectIsCondoLikeRaw ? [0.7, 1.4] : [0.5, 2.0]
          if (ratio < minR || ratio > maxR) return false
        }
        // Zip guard for condo-like subjects: a different building in a
        // different zip is a different neighborhood, different HOA, and
        // different construction vintage — not a real comp for a condo
        // unit. Same audit: 21202 Harbor East subject getting 21230
        // Ridgely's Delight townhouse-condos pulled into the comp set.
        if (!isSameBuilding && subjectIsCondoLikeRaw && subjectZip) {
          const compZip = parseAddressParts(addr).zip
          if (compZip && compZip !== subjectZip) return false
        }
        if (!isSameBuilding && subjectValue) {
          const ratio = c.estimated_value / subjectValue
          if (ratio < 0.25 || ratio > 4.0) return false
        }
        // Drop stale sales (only when a sold_date is available — missing
        // date shouldn't silently disqualify otherwise-valid records).
        if (c.sold_date) {
          const t = new Date(c.sold_date).getTime()
          if (Number.isFinite(t) && t < STALE_CUTOFF_MS) return false
        }
        return true
      })

      // Partition by building. Same-building comps are always stronger
      // anchors than random 1-mile neighborhood matches. Audit case: 1330
      // New Hampshire Ave NW DC ("The Apolline") returned 4 comps from
      // 1101 L St NW ("The Wisteria", 0.7 mi away) while Apolline sales
      // existed in Rentcast. Preferring same-building fixes this without
      // changing the query radius.
      const sameBuilding: typeof cleaned = []
      const other: typeof cleaned = []
      for (const c of cleaned) {
        const k = buildingKey(c.address || '')
        if (subjectBuildingKey && k && k === subjectBuildingKey) sameBuilding.push(c)
        else other.push(c)
      }
      const byRecency = (a: any, b: any) => {
        const da = a.sold_date ? new Date(a.sold_date).getTime() : 0
        const db = b.sold_date ? new Date(b.sold_date).getTime() : 0
        return db - da
      }
      sameBuilding.sort(byRecency)
      other.sort(byRecency)

      // When subject is a condo/apartment AND we have 2+ same-building
      // comps, never fall back to other-building matches — a different
      // building (different HOA, construction, amenities) isn't a real
      // comp for a condo unit. Preserves the same-building ordering but
      // prevents stale cross-building comps from leaking in to pad count.
      const subjectPtLower = String(subject?.propertyType || '').toLowerCase()
      const subjectIsCondoLike =
        /condo|apartment|co-?op|coop/.test(subjectPtLower) || subjectAddrHasUnit
      // Even one same-building comp beats cross-building fallback for a
      // condo unit — different buildings carry different HOA, amenities,
      // and construction vintage. Threshold dropped from 2 to 1.
      const preferSameBuildingOnly = subjectIsCondoLike && sameBuilding.length >= 1
      const finalList = preferSameBuildingOnly
        ? sameBuilding.slice(0, 4)
        : [...sameBuilding, ...other].slice(0, 4)
      // Tag each comp so the report can flag "comps came from other buildings"
      // when the majority don't share a building with the subject.
      return finalList.map((c: any) => ({
        ...c,
        same_building: subjectBuildingKey
          ? buildingKey(c.address || '') === subjectBuildingKey
          : false,
      }))
    } catch {
      return []
    }
  }
  return []
}

// Stub property data for MVP demo (when no API key is configured)
function generateStubProperty(address: string): PropertyData {
  const parts = address.split(',').map(s => s.trim())
  const streetAddr = parts[0] || address
  const city = parts[1] || 'Austin'
  const stateZip = parts[2] || 'TX 78701'
  const stateMatch = stateZip.match(/([A-Z]{2})/)
  const state = stateMatch ? stateMatch[1] : 'TX'
  const zipMatch = stateZip.match(/(\d{5})/)
  const zip = zipMatch ? zipMatch[1] : '78701'

  // Generate plausible values based on simple hash of address
  const hash = address.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const basePrice = 280000 + (hash % 400) * 1000

  return {
    property_id: `stub-${hash}`,
    address: streetAddr,
    city,
    state,
    zip_code: zip,
    bedrooms: 3 + (hash % 3),
    bathrooms: 2 + (hash % 2),
    property_type: 'Single Family',
    estimated_value: basePrice,
    year_built: 1990 + (hash % 30),
    square_feet: 1400 + (hash % 10) * 100,
  }
}
