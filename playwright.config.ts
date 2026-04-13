import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for DealDoctor E2E pressure tests.
 *
 * - Spec files live under tests/pressure/e2e/*.spec.ts (vitest uses .test.ts,
 *   so the two runners don't step on each other)
 * - Reuses a running `next dev` on 3000 when available, otherwise spawns one
 * - Chromium only; cross-browser isn't useful for investor-tool regressions
 */
export default defineConfig({
  testDir: './tests/pressure/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // sequential to avoid port + DB-row collisions
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'line',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
