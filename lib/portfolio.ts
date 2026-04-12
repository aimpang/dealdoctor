// Client-side portfolio persistence. LocalStorage-only for now (no accounts).
// Keeps a user's saved deals across sessions on the same browser. When we
// introduce user accounts, we migrate these into the DB server-side on signup.

export interface SavedDeal {
  uuid: string
  address: string
  cityState: string
  savedAt: string // ISO date
  verdict?: 'DEAL' | 'MARGINAL' | 'PASS'
  dealScore?: number
  offer?: number
  breakevenDelta?: number   // positive = offer below breakeven
  fiveYrWealth?: number
  fiveYrIRR?: number
}

const KEY = 'dealdoctor:portfolio:v1'

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function listSavedDeals(): SavedDeal[] {
  if (!isBrowser()) return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveDeal(deal: SavedDeal): SavedDeal[] {
  if (!isBrowser()) return []
  const existing = listSavedDeals().filter((d) => d.uuid !== deal.uuid)
  const next = [deal, ...existing]
  window.localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function removeDeal(uuid: string): SavedDeal[] {
  if (!isBrowser()) return []
  const next = listSavedDeals().filter((d) => d.uuid !== uuid)
  window.localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function isSaved(uuid: string): boolean {
  return listSavedDeals().some((d) => d.uuid === uuid)
}
