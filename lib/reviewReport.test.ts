import { describe, expect, it } from 'vitest'
import { runReviewLoop, type ReviewResult } from './reviewReport'

describe('runReviewLoop reviewer error policy', () => {
  const reviewerUnavailable: ReviewResult = {
    verdict: 'clean',
    confidence: 0,
    concerns: [],
    summary: '(reviewer unavailable — shipped without review)',
    round: 1,
    error: 'network-timeout',
  }

  it('ships by default when the reviewer errors', async () => {
    const result = await runReviewLoop(
      { ltr: { monthlyNetCashFlow: 100 } },
      { diagnosis: 'okay' },
      async () => ({ diagnosis: 'rewrite' }),
      {
        review: async () => reviewerUnavailable,
      }
    )

    expect(result.outcome.blocked).toBe(false)
    expect(result.outcome.finalSummary).toContain('reviewer unavailable')
  })

  it('blocks when configured to fail closed on reviewer errors', async () => {
    const result = await runReviewLoop(
      { ltr: { monthlyNetCashFlow: 100 } },
      { diagnosis: 'okay' },
      async () => ({ diagnosis: 'rewrite' }),
      {
        review: async () => reviewerUnavailable,
        reviewerErrorPolicy: 'block',
      }
    )

    expect(result.outcome.blocked).toBe(true)
    expect(result.outcome.finalSummary).toMatch(/reviewer unavailable/i)
  })
})
