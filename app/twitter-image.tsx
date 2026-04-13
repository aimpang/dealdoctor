import { renderOgCard, OG_SIZE } from './_og-card'

// Twitter card — identical art to the OpenGraph card. This file exists so
// Next.js populates <meta name="twitter:image">.

export const runtime = 'edge'
export const alt = 'DealDoctor — deal diagnostics for serious real-estate investors'
export const size = OG_SIZE
export const contentType = 'image/png'

export default function Image() {
  return renderOgCard()
}
