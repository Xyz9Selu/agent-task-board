// Minimal vitest config — vite.config.ts depends on @vitejs/plugin-react which
// is only needed for the habit-tracker dev server. Tests don't need it.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});