import type { MetadataRoute } from 'next'
import { absoluteUrl } from '@/lib/seo'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'weekly', priority: 1.0 },
    { url: absoluteUrl('/methodology'), lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: absoluteUrl('/pricing'), lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/retrieve'), lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
  ]
}
