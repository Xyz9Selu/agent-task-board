import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Use jsdom only where a test asks for it via `// @vitest-environment jsdom`.
    // The CLI / Node-side tests in this repo run in the default `node`
    // environment and must not be forced into jsdom.
    environmentMatchGlobs: [
      ['tests/component/**', 'jsdom'],
    ],
    setupFiles: ['./tests/setup.ts'],
  },
})