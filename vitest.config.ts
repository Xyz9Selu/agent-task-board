import { defineConfig } from 'vitest/config'

/**
 * Vitest config — the Playwright e2e spec in `tests/e2e/` is run by
 * `@playwright/test` (see `playwright.config.ts`). Excluding it here
 * keeps vitest focused on real unit tests under `tests/unit/` and
 * `tests/integration/`.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
})