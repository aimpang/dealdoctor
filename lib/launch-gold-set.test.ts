import { describe, expect, it } from 'vitest'
import { evaluateFirstPageTrust } from './first-page-trust'
import { LAUNCH_GOLD_SET_CASES } from './launch-gold-set'

describe('launch gold set', () => {
  it('keeps the launch validation set aligned with the trust contract', () => {
    for (const launchGoldSetCase of LAUNCH_GOLD_SET_CASES) {
      const trustAssessment = evaluateFirstPageTrust(launchGoldSetCase.input)

      expect(
        {
          investorSignal: trustAssessment.investorSignal,
          status: trustAssessment.status,
          suppressBreakevenSignal: trustAssessment.suppressBreakevenSignal,
          suppressForwardProjection: trustAssessment.suppressForwardProjection,
        },
        launchGoldSetCase.scenarioId
      ).toEqual({
        investorSignal: launchGoldSetCase.expectation.expectedInvestorSignal,
        status: launchGoldSetCase.expectation.expectedStatus,
        suppressBreakevenSignal: launchGoldSetCase.expectation.suppressBreakevenSignal,
        suppressForwardProjection: launchGoldSetCase.expectation.suppressForwardProjection,
      })
    }
  })
})

