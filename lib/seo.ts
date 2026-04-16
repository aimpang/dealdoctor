export const DEFAULT_SITE_URL = 'https://dealdoctor.us'

export const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? DEFAULT_SITE_URL).replace(/\/$/, '')

export const DISPLAY_SITE_HOSTNAME = (() => {
  try {
    return new URL(BASE_URL).hostname.replace(/^www\./, '')
  } catch {
    return 'dealdoctor.us'
  }
})()

export const INDEXABLE_SITEMAP_ENTRIES = [
  { path: '/', changeFrequency: 'weekly', priority: 1.0 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/methodology', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
] as const

export const absoluteUrl = (path: string): string => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${BASE_URL}${cleanPath}`
}
