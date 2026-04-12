import type { Metadata } from 'next'
import { prisma } from '@/lib/db'

// Server-side metadata per report — gives shared links a real title + description.
// Next.js auto-joins this with the opengraph-image.tsx convention so Twitter/Slack/
// email previews show the dynamic report card + the correct title.
export async function generateMetadata({
  params,
}: {
  params: { uuid: string }
}): Promise<Metadata> {
  const report = await prisma.report.findUnique({ where: { id: params.uuid } })
  if (!report) {
    return {
      title: 'DealDoctor — Report not found',
    }
  }

  const full: any = report.fullReportData ? JSON.parse(report.fullReportData) : null
  const verdict = full?.ltr?.verdict
  const delta = full?.breakeven?.delta

  let subtitle = 'Instant underwriting for a US rental investment'
  if (full && delta != null) {
    const deltaStr =
      delta < 0
        ? `offer is $${Math.abs(Math.round(delta)).toLocaleString()} above breakeven`
        : `offer is $${Math.round(delta).toLocaleString()} below breakeven`
    subtitle = `${verdict === 'DEAL' ? 'Strong Deal' : verdict === 'MARGINAL' ? 'Marginal' : 'Pass'} — ${deltaStr}`
  }

  const title = `${report.address}, ${report.city}, ${report.state} — DealDoctor`
  return {
    title,
    description: subtitle,
    openGraph: {
      title,
      description: subtitle,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: subtitle,
    },
  }
}

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return children
}
