import type { Metadata } from 'next'
import { cache } from 'react'
import { prisma } from '@/lib/db'
import { BASE_URL, absoluteUrl } from '@/lib/seo'

const getReport = cache(async (uuid: string) => {
  return prisma.report.findUnique({ where: { id: uuid } })
})

export async function generateMetadata({
  params,
}: {
  params: { uuid: string }
}): Promise<Metadata> {
  const report = await getReport(params.uuid)
  if (!report) {
    return {
      title: 'Report not found',
      robots: { index: false, follow: false },
    }
  }

  const full: any = report.fullReportData ? JSON.parse(report.fullReportData) : null
  const verdict = full?.ltr?.verdict
  const delta = full?.breakeven?.delta

  let subtitle = 'Instant underwriting for a US rental investment property'
  if (full && delta != null) {
    const deltaStr =
      delta < 0
        ? `offer is $${Math.abs(Math.round(delta)).toLocaleString()} above breakeven`
        : `offer is $${Math.round(delta).toLocaleString()} below breakeven`
    subtitle = `${verdict === 'DEAL' ? 'Strong Deal' : verdict === 'MARGINAL' ? 'Marginal' : 'Pass'} — ${deltaStr}`
  }

  const title = `Deal Doctor - ${report.address}, ${report.city}, ${report.state}`
  const url = absoluteUrl(`/report/${params.uuid}`)
  return {
    title,
    description: subtitle,
    alternates: { canonical: url },
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noarchive: true } },
    openGraph: {
      title,
      description: subtitle,
      type: 'article',
      url,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: subtitle,
    },
  }
}

export default async function ReportLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { uuid: string }
}) {
  const report = await getReport(params.uuid)

  const productJsonLd = report
    ? {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: `${report.address}, ${report.city}, ${report.state}`,
        description: 'DealDoctor investment analysis report for a US rental property.',
        brand: { '@type': 'Brand', name: 'DealDoctor' },
        offers: {
          '@type': 'Offer',
          price: '24.99',
          priceCurrency: 'USD',
          url: absoluteUrl('/pricing'),
          availability: 'https://schema.org/InStock',
        },
      }
    : null

  const breadcrumbJsonLd = report
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
          {
            '@type': 'ListItem',
            position: 2,
            name: `${report.address}, ${report.city}, ${report.state}`,
            item: absoluteUrl(`/report/${params.uuid}`),
          },
        ],
      }
    : null

  return (
    <>
      {productJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
        />
      )}
      {breadcrumbJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />
      )}
      {children}
    </>
  )
}
