import type { MetadataRoute } from 'next'
import { INDEXABLE_SITEMAP_ENTRIES, absoluteUrl } from '@/lib/seo'

const sitemap = (): MetadataRoute.Sitemap => {
  const buildTimestamp = new Date()

  return INDEXABLE_SITEMAP_ENTRIES.map(({ path, changeFrequency, priority }) => ({
    url: absoluteUrl(path),
    lastModified: buildTimestamp,
    changeFrequency,
    priority,
  }))
}

export default sitemap
