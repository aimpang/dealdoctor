import { test, expect, type Page } from '@playwright/test'
import { installStubs, STUB_UUID } from './fetch-stubs'

/**
 * Golden-path E2E pressure test.
 *
 * Walks the core user journey end-to-end in a headless browser with all
 * external API calls stubbed from the Austin baseline fixture:
 *
 *   landing → type address → submit → teaser renders in-place
 *   direct navigation → /report/{uuid}?debug=1 → full report sections render
 *
 * Catches: broken navigation, hydration errors, missing components, unhandled
 * JS exceptions that the unit + scenario suites can't see. Manual / CI only,
 * not in pre-push (chromium download ~300MB).
 *
 * Note: address submit does NOT navigate to /report/{uuid} — the teaser
 * appears in-place above the paywall. The report page is reached either via
 * LemonSqueezy checkout (external, untested) or, in dev, the bypass link.
 * We test the report page by direct navigation so the assertion doesn't
 * depend on a dev-only affordance.
 */

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    // Dev-mode React noise — not regressions
    if (
      text.includes('[Fast Refresh]') ||
      text.includes('[webpack-hmr]') ||
      text.includes('Download the React DevTools')
    ) return
    errors.push(text)
  })
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`)
  })
  return errors
}

test.describe('golden-path pressure test', () => {
  test('landing renders and address submit produces an inline teaser', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page)
    await installStubs(page)

    await page.goto('/')
    await expect(page).toHaveTitle(/DealDoctor/i)

    const addressInput = page.getByPlaceholder(/evergreen terrace/i)
    await expect(addressInput).toBeVisible({ timeout: 10_000 })

    await addressInput.fill('1500 W Anderson Ln, Austin, TX 78757')
    await addressInput.press('Enter')

    // Teaser renders in-place — the four SubStat tiles (Est. Value, Est. Rent,
    // Breakeven, Investor Rate) now constitute the whole teaser (the verdict
    // hero was removed intentionally — data without interpretation).
    await expect(page.getByText(/breakeven/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/investor rate/i).first()).toBeVisible()

    // Paywall renders below the teaser
    await expect(page.getByRole('heading', { name: /unlock full report/i })).toBeVisible()

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('report page renders core sections via debug bypass', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page)
    await installStubs(page)

    // Direct nav to the stub UUID — the /api/report/[uuid] route is stubbed
    // to return paid: true + the full report payload, so no checkout needed.
    await page.goto(`/report/${STUB_UUID}?debug=1`)

    // Core FullReport sections — labels taken directly from FullReport.tsx
    await expect(page.getByText(/offer vs breakeven/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/5-year wealth built/i).first()).toBeVisible()
    await expect(page.getByText(/financing alternatives/i).first()).toBeVisible()

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('report page handles missing UUID gracefully', async ({ page }) => {
    await page.goto('/report/nonexistent-uuid-that-will-404')
    // Either a graceful "not found" state or a redirect — anything but a crash
    await expect(page.getByText(/not found|error|loading/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})
