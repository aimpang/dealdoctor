import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Portfolio',
  description: 'Your saved DealDoctor reports for side-by-side investment comparison.',
  robots: { index: false, follow: false },
}

export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  return children
}
