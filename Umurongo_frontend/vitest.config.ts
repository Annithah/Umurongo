import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component and unit tests (jsdom). End-to-end tests live in /e2e and use Playwright.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
  },
});
