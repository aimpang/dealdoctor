import type { Metadata } from 'next'
import { absoluteUrl } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Retrieve Your DealDoctor Report',
  description:
    'Lost your DealDoctor report link? Enter your email to get a magic-link restore. Re-establishes your 5-Pack or Unlimited entitlement on any device.',
  alternates: { canonical: '/retrieve' },
  openGraph: {
    title: 'Retrieve Your DealDoctor Report',
    description: 'Magic-link restore for lost report URLs.',
    url: absoluteUrl('/retrieve'),
    type: 'website',
  },
  robots: { index: true, follow: true },
}

export default function RetrieveLayout({ children }: { children: React.ReactNode }) {
  return children
}
