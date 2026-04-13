import { renderOgCard, OG_SIZE } from './_og-card'

// Root-level OpenGraph card — 1200×630 PNG rendered for every share preview
// (Twitter, Slack, iMessage, LinkedIn, Discord, email link-unfurl).

export const runtime = 'edge'
export const alt = 'DealDoctor — deal diagnostics for serious real-estate investors'
export const size = OG_SIZE
export const contentType = 'image/png'

export default function Image() {
  return renderOgCard()
}
