import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the issue #19 review. Boots the Vite dev server on
 * 5174 and runs the e2e specs in `tests/e2e/`. (Port 5173 is occupied by a
 * stale dev server from another project on this host.) The HTML report is
 * written to `playwright-report/` next to the screenshots.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'tests/e2e/test-results',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})