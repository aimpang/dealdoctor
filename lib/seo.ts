export const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dealdoctor.com').replace(/\/$/, '')

export function absoluteUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  return `${BASE_URL}${clean}`
}
