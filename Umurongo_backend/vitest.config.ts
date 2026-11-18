import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// API tests re-seed their database, so they use TEST_DATABASE_URL when it is set
// and never touch the development data in DATABASE_URL.
const withPoolLimit = (url: string) => `${url}${url.includes('?') ? '&' : '?'}connection_limit=5`;
const testDb = process.env.TEST_DATABASE_URL ? withPoolLimit(process.env.TEST_DATABASE_URL) : undefined;

// API tests share one database, so run files one after another.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      SMS_MODE: 'simulate',
      SMS_WEBHOOK_SECRET: 'test-webhook-secret',
      PUBLIC_WEB_URL: 'https://umurongo.test',
      JOBS_ENABLED: 'false',
      ...(testDb ? { DATABASE_URL: testDb } : {}),
    },
  },
});
