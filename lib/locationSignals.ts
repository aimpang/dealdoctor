// Location quality signals via Mapbox Tilequery (free tier, ~100k req/mo).
// Pulls POIs within an 800m / ~0.5mi radius of the property and buckets them
// into the categories that matter for rental demand: restaurants, groceries,
// schools, parks, transit. Produces a composite walkability score + per-category
// counts and nearest-distance. Zero new infra — we already have the Mapbox token.

export interface AmenityStat {
  count: number
  nearestMeters: number | null
}

export interface LocationSignals {
  walkabilityScore: number     // 0-100, weighted amenity density
  walkabilityLabel: string     // "Walker's Paradise" → "Very Car-Dependent"
  radiusMeters: number
  amenities: {
    restaurants: AmenityStat
    groceries: AmenityStat
    schools: AmenityStat
    parks: AmenityStat
    transit: AmenityStat
  }
}

type Category = keyof LocationSignals['amenities']

function classify(feature: any): Category | null {
  const props = feature?.properties || {}
  const klass: string = props.class || ''
  const type: string = props.type || ''
  const layer: string = props.tilequery?.layer || ''

  if (layer === 'transit_stop_label') return 'transit'
  if (
    klass === 'food_and_drink' ||
    ['restaurant', 'cafe', 'bar', 'fast_food', 'food_court'].includes(type)
  ) {
    return 'restaurants'
  }
  if (
    klass === 'grocery' ||
    ['supermarket', 'grocery', 'convenience'].includes(type)
  ) {
    return 'groceries'
  }
  if (
    klass === 'education' ||
    ['school', 'college', 'university', 'kindergarten'].includes(type)
  ) {
    return 'schools'
  }
  if (klass === 'park' || type === 'park') {
    return 'parks'
  }
  return null
}

function labelFor(score: number): string {
  if (score >= 90) return "Walker's Paradise"
  if (score >= 70) return 'Very Walkable'
  if (score >= 50) return 'Somewhat Walkable'
  if (score >= 25) return 'Car-Dependent'
  return 'Very Car-Dependent'
}

export async function getLocationSignals(
  lat: number,
  lng: number
): Promise<LocationSignals | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  if (!token) return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const radiusMeters = 800

  try {
    const url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json?radius=${radiusMeters}&limit=50&layers=poi_label,transit_stop_label&access_token=${encodeURIComponent(token)}`
    const res = await fetch(url, { next: { revalidate: 86400 } })
    if (!res.ok) return null

    const data = await res.json()
    const features = Array.isArray(data?.features) ? data.features : []

    const empty = (): AmenityStat => ({ count: 0, nearestMeters: null })
    const amenities = {
      restaurants: empty(),
      groceries: empty(),
      schools: empty(),
      parks: empty(),
      transit: empty(),
    }

    // Dedupe by name+class to avoid the same POI being counted twice if it
    // appears in both the POI and transit layers (rare but possible).
    const seen = new Set<string>()

    for (const f of features) {
      const cat = classify(f)
      if (!cat) continue

      const name = (f.properties?.name || '') + '|' + (f.properties?.class || '')
      if (seen.has(name) && name !== '|') continue
      seen.add(name)

      amenities[cat].count += 1
      const dist = f.properties?.tilequery?.distance
      if (typeof dist === 'number') {
        const rounded = Math.round(dist)
        if (amenities[cat].nearestMeters == null || rounded < amenities[cat].nearestMeters!) {
          amenities[cat].nearestMeters = rounded
        }
      }
    }

    // Weighted walkability score — groceries and transit weight heaviest because
    // they drive day-to-day utility for renters; restaurants/schools/parks
    // matter but are more substitutable.
    const raw =
      amenities.groceries.count * 5 +
      amenities.transit.count * 4 +
      amenities.restaurants.count * 3 +
      amenities.schools.count * 3 +
      amenities.parks.count * 2

    // Normalize: ~60 raw points = 100 (dense urban core)
    const walkabilityScore = Math.min(100, Math.max(0, Math.round((raw / 60) * 100)))

    return {
      walkabilityScore,
      walkabilityLabel: labelFor(walkabilityScore),
      radiusMeters,
      amenities,
    }
  } catch {
    return null
  }
}

export function metersToMiles(m: number): number {
  return Math.round((m / 1609.344) * 100) / 100
}
