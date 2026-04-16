import type { Metadata } from 'next'
import { absoluteUrl } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Retrieve Your Purchased DealDoctor Report',
  description:
    'Lost your DealDoctor report link? Enter your email to get a magic-link restore. Re-establishes your 5-Pack or Unlimited entitlement on any device.',
  alternates: { canonical: '/retrieve' },
  openGraph: {
    siteName: 'DealDoctor',
    title: 'Retrieve Your Purchased DealDoctor Report',
    description: 'Magic-link restore for lost report URLs.',
    url: absoluteUrl('/retrieve'),
    type: 'website',
  },
  robots: {
    index: false,
    follow: true,
    nocache: true,
    googleBot: {
      index: false,
      follow: true,
      noarchive: true,
    },
  },
}

const RetrieveLayout = ({ children }: { children: React.ReactNode }) => children

export default RetrieveLayout
