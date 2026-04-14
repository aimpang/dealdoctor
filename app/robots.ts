import type { MetadataRoute } from 'next'
import { BASE_URL } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/methodology', '/pricing', '/retrieve'],
        disallow: ['/api/', '/report/', '/portfolio/'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
