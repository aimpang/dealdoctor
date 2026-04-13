import type { AiGenerator } from '../../../lib/reportGenerator'

/**
 * Deterministic Claude stub — used by scenario tests and by the E2E
 * stub-payload builder. Lives in its own module (no vitest import) so it
 * can be loaded from contexts outside vitest (tsx scripts, Playwright).
 */
export const STUB_DEAL_DOCTOR: AiGenerator = async () => ({
  diagnosis: 'Test diagnosis for fixture replay.',
  tonePositive: false,
  bottomLine: 'Bottom line: stubbed for pressure test.',
  pros: ['stub pro 1', 'stub pro 2'],
  cons: ['stub con 1', 'stub con 2'],
  negotiationLevers: [
    { lever: 'Price reduction', script: 'Stub script.' },
    { lever: 'Closing credit', script: 'Stub script.' },
  ],
  inspectionRedFlags: [
    { area: 'Roof', why: 'Stub reason.' },
    { area: 'HVAC', why: 'Stub reason.' },
  ],
  fixes: [
    {
      title: 'Fix 1',
      subtitle: 'stub',
      difficulty: 'easy',
      resultValue: '$0',
      resultLabel: 'stub',
      detailRows: [{ label: 'stub', value: 'stub' }],
    },
  ],
})
