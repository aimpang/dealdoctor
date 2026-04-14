import { buildingKey } from './propertyApi'

export interface BuildingHoaRecord {
  monthlyHoa: number
  includes?: string
  source: string
}

// Keys must match the output of buildingKey() in propertyApi.ts exactly —
// "<number> <direction?> <streetCore tokens>" lowercased, with the street
// suffix dropped. For "922 24th St NW" buildingKey returns "922 nw 24th".
const BUILDING_HOA_DB: Record<string, BuildingHoaRecord> = {
  '922 nw 24th': {
    monthlyHoa: 717,
    includes: 'AC, electricity, heat, water, sewer, trash, master insurance, reserves, custodial, security',
    source: 'Jefferson House condo docs (avg)',
  },
  '414 water': {
    monthlyHoa: 1036,
    includes: 'water, sewer, trash, master insurance, reserves, concierge, gym, pool, common areas',
    source: 'Spinnaker Bay / 414 Water St (Baltimore) unit-survey avg (~$400–$1,200 observed range)',
  },
}

export function lookupBuildingHoa(address: string): BuildingHoaRecord | null {
  const key = buildingKey(address)
  if (!key) return null
  return BUILDING_HOA_DB[key] ?? null
}

// Every address in BUILDING_HOA_DB is a known condominium building. Used to
// normalize Rentcast's "Apartment" property_type to "Condo" for buildings we
// have direct records for — investors buying a unit own a deeded condo.
export function isKnownCondoBuilding(address: string): boolean {
  return lookupBuildingHoa(address) !== null
}
