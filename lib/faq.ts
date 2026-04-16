export interface FaqItem {
  q: string
  a: string
}

export const FAQ: readonly FaqItem[] = [
  {
    q: 'How accurate are the numbers?',
    a: 'The math is exact; the inputs are estimates. AVMs (property value, rent) carry ±10–15% error bars by design. Mortgage math, DSCR, depreciation, and breakeven are deterministic given those inputs. Every data source is cited in the report footer and on the Methodology page — no magic.',
  },
  {
    q: 'I lost my report link — what now?',
    a: "Go to Retrieve access in the nav, enter your email, and we'll send a restore link. Clicking it re-establishes your session on any device — your 5-Pack balance or Unlimited subscription applies automatically.",
  },
  {
    q: 'How do 5-Pack and Unlimited work if there are no accounts?',
    a: 'After purchase, we set a cookie on your browser that maps to your email. Every new address you search is automatically paid for and opens the full report — no second paywall. On a new device, use the magic-link Retrieve flow to restore access.',
  },
  {
    q: "What's your refund policy?",
    a: "Reply to your receipt email within 7 days if a report failed to generate or the underlying property data was materially wrong. Unlimited can be cancelled anytime from LemonSqueezy's portal — cancellation stops future renewals, and access continues through the period you've already paid for.",
  },
  {
    q: 'Can I export to Excel or PDF?',
    a: 'Yes. Every paid report has a multi-sheet Excel export covering summary, year-1 metrics, 5-year projection, sensitivity, financing, recommended offers, comps, assumptions, and quality audit, plus a Print/Save-as-PDF with an investor-ready print stylesheet.',
  },
  {
    q: 'How is this different from BiggerPockets or DealCheck?',
    a: "DealDoctor is built around refusal discipline, not feature sprawl. If the listing price, rent, comps, or property profile are too weak or contradictory, we downgrade or block the report instead of pretending the answer is clean. When a report does ship, every paid report links back to Zillow, Redfin, and Realtor so you can verify the subject in one click.",
  },
]
