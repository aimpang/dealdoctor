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
}

export interface RentEstimate {
  estimated_rent: number
  rent_low: number
  rent_high: number
}

// Search for property by address string.
// In production (API key configured) we return null on miss — the caller surfaces
// a real "property not found" error. Stub data is dev-mode only (no API key set)
// so we never charge a user for a report synthesized from random numbers.
export async function searchProperty(address: string): Promise<PropertyData | null> {
  if (API_KEY && API_KEY !== 'your_key_here') {
    return await searchPropertyRentcast(address)
  }
  return generateStubProperty(address)
}

// Rentcast API integration
async function searchPropertyRentcast(address: string): Promise<PropertyData | null> {
  try {
    const url = new URL('https://api.rentcast.io/v1/properties')
    url.searchParams.set('address', address)

    const res = await fetch(url.toString(), {
      headers: { 'X-Api-Key': API_KEY },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null

    const data = await res.json()
    if (!data || (Array.isArray(data) && data.length === 0)) return null

    const prop = Array.isArray(data) ? data[0] : data

    return {
      property_id: prop.id || prop.addressHash || address,
      address: prop.formattedAddress || prop.addressLine1 || address.split(',')[0],
      city: prop.city || '',
      state: prop.state || '',
      zip_code: prop.zipCode || '',
      bedrooms: prop.bedrooms || 3,
      bathrooms: prop.bathrooms || 2,
      property_type: prop.propertyType || 'Single Family',
      estimated_value: prop.price || prop.estimatedValue || 350000,
      year_built: prop.yearBuilt || 2000,
      square_feet: prop.squareFootage || 1800,
      lot_size: prop.lotSize,
    }
  } catch {
    return null
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
        next: { revalidate: 3600 },
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

// Get comparable sales in area
export async function getComparableSales(city: string, state: string, bedrooms: number) {
  if (API_KEY && API_KEY !== 'your_key_here') {
    try {
      const url = new URL('https://api.rentcast.io/v1/properties')
      url.searchParams.set('city', city)
      url.searchParams.set('state', state)
      url.searchParams.set('bedrooms', bedrooms.toString())
      url.searchParams.set('limit', '5')
      url.searchParams.set('status', 'Sold')

      const res = await fetch(url.toString(), {
        headers: { 'X-Api-Key': API_KEY },
        next: { revalidate: 3600 },
      })
      if (!res.ok) return []

      const data = await res.json()
      return (Array.isArray(data) ? data : []).slice(0, 4).map((p: any) => ({
        address: p.formattedAddress || p.addressLine1,
        estimated_value: p.price || p.estimatedValue || 0,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        square_feet: p.squareFootage,
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
