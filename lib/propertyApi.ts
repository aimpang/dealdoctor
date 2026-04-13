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

function diagnoseRentcastResponse(res: Response): 'ok' | 'quota' | 'rate-limit' | 'error' {
  if (res.ok) return 'ok'
  if (res.status === 401 || res.status === 403) return 'quota'
  if (res.status === 429) return 'rate-limit'
  return 'error'
}

// Rentcast's dedicated value AVM endpoint. Returns a real estimate with a
// confidence band. The property lookup endpoint (/properties) doesn't include
// a price in most responses — you need /avm/value for that.
async function fetchValueAvm(address: string): Promise<{
  price: number
  low: number
  high: number
} | null> {
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
    return {
      price,
      low: Number(d?.priceRangeLow) || price,
      high: Number(d?.priceRangeHigh) || price,
    }
  } catch (err) {
    if (err instanceof RentcastQuotaError) throw err // bubble up quota issues
    return null
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
    if (!propRes.ok) return null

    const data = await propRes.json()
    if (!data || (Array.isArray(data) && data.length === 0)) return null

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
      bedrooms: prop.bedrooms || 3,
      bathrooms: prop.bathrooms || 2,
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
    }
  } catch {
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

    const saleNow =
      data?.saleData?.averagePrice ?? data?.saleData?.medianPrice ?? null
    const rentNow =
      data?.rentalData?.averageRent ?? data?.rentalData?.medianRent ?? null

    // Find the oldest point in the history window (12 months back)
    const saleHistory = data?.saleData?.history ?? {}
    const rentHistory = data?.rentalData?.history ?? {}
    const oldestSaleKey = Object.keys(saleHistory).sort()[0]
    const oldestRentKey = Object.keys(rentHistory).sort()[0]
    const saleThen =
      oldestSaleKey
        ? saleHistory[oldestSaleKey]?.averagePrice ?? saleHistory[oldestSaleKey]?.medianPrice
        : null
    const rentThen =
      oldestRentKey
        ? rentHistory[oldestRentKey]?.averageRent ?? rentHistory[oldestRentKey]?.medianRent
        : null

    const growth = (now: number | null, then: number | null): number | null =>
      now && then && then > 0
        ? Math.round(((now - then) / then) * 10000) / 10000
        : null

    return {
      zipCode,
      salePriceMedian: saleNow,
      rentMedian: rentNow,
      pricePerSqft: data?.saleData?.averagePricePerSquareFoot ?? null,
      rentPerSqft: data?.rentalData?.averageRentPerSquareFoot ?? null,
      avgDaysOnMarket: data?.saleData?.averageDaysOnMarket ?? null,
      salePriceGrowth12mo: growth(saleNow, saleThen),
      rentGrowth12mo: growth(rentNow, rentThen),
    }
  } catch {
    return null
  }
}

// Rent comparables — separate function because we only need them for the paid
// full report, not the pre-paywall teaser. Keeps preview fast.
export async function getRentComps(address: string, bedrooms: number): Promise<RentComp[]> {
  if (!API_KEY || API_KEY === 'your_key_here') return []
  try {
    const url = new URL('https://api.rentcast.io/v1/avm/rent/long-term')
    url.searchParams.set('address', address)
    url.searchParams.set('bedrooms', String(bedrooms))
    url.searchParams.set('compCount', '5')

    const res = await fetch(url.toString(), {
      headers: { 'X-Api-Key': API_KEY },
      next: { revalidate: 86_400 }, // 24h cache — property data barely changes day-to-day; dramatically reduces API burn on repeat addresses
    })
    if (!res.ok) return []
    const data = await res.json()
    const comps = Array.isArray(data?.comparables) ? data.comparables : []
    return comps
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
      .slice(0, 5)
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
// `subject` — the subject property's sqft + estimated value. Used to filter
// out non-residential Rentcast records that otherwise poison the comp median:
// parking spaces, storage units, boat slips, tax-auction outcomes, and
// assessor-only records with nonsense prices (we saw a $21,500 median once
// for a $275k high-rise condo because the API returned a parking deed).
export async function getComparableSales(
  city: string,
  state: string,
  bedrooms: number,
  coords?: { lat: number; lng: number } | null,
  radiusMiles: number = 1.0,
  subject?: { sqft?: number | null; value?: number | null } | null
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
      // Request more than we'll show — we're about to filter aggressively.
      url.searchParams.set('limit', '20')
      url.searchParams.set('status', 'Sold')

      const res = await fetch(url.toString(), {
        headers: { 'X-Api-Key': API_KEY },
        next: { revalidate: 86_400 }, // 24h cache — property data barely changes day-to-day; dramatically reduces API burn on repeat addresses
      })
      if (!res.ok) return []

      const data = await res.json()
      const subjectSqft = subject?.sqft && subject.sqft > 0 ? subject.sqft : null
      const subjectValue = subject?.value && subject.value > 0 ? subject.value : null

      return (Array.isArray(data) ? data : [])
        .map((p: any) => {
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
          }
        })
        .filter((c: any) => {
          // Price floor: any residential unit sold for under $30k is almost
          // certainly a parking deed, storage unit, tax-auction, or data glitch.
          if (!(c.estimated_value > 30_000)) return false
          // Comps with no sqft can't be scale-validated — drop when we have a
          // subject sqft to compare against; keep otherwise.
          if (subjectSqft && (!c.square_feet || c.square_feet < 200)) return false
          // Sqft similarity: within 0.5× – 2.0× of the subject filters out
          // studios-mixed-with-penthouses and tiny parking-style records.
          if (subjectSqft && c.square_feet) {
            const ratio = c.square_feet / subjectSqft
            if (ratio < 0.5 || ratio > 2.0) return false
          }
          // Value similarity: 0.25× – 4.0× of the subject. Wide enough to
          // accept reasonable market variation, narrow enough to exclude
          // outliers that skew the median.
          if (subjectValue) {
            const ratio = c.estimated_value / subjectValue
            if (ratio < 0.25 || ratio > 4.0) return false
          }
          return true
        })
        .slice(0, 4)
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
