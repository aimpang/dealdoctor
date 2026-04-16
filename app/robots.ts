import type { MetadataRoute } from 'next'
import { BASE_URL } from '@/lib/seo'

const robots = (): MetadataRoute.Robots => ({
  rules: {
    userAgent: '*',
    allow: '/',
    disallow: ['/api/', '/portfolio/', '/report/'],
  },
  sitemap: `${BASE_URL}/sitemap.xml`,
  host: BASE_URL,
})

export default robots
