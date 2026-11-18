// End-to-end tests: the real API (port 4100, test database) and the Vite dev server (port 5174).
// Run: npm run test:e2e   (first time: npx playwright install chromium)
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

const backendEnv = loadEnv({ path: 'Umurongo_backend/.env' }).parsed ?? {};
const testDb = process.env.TEST_DATABASE_URL ?? backendEnv.TEST_DATABASE_URL;
if (!testDb) throw new Error('Set TEST_DATABASE_URL (in Umurongo_backend/.env): the e2e tests reset that database.');

const API_PORT = 4100;
const WEB_PORT = 5174;
const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: 'Umurongo_backend',
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        ...backendEnv,
        DATABASE_URL: testDb,
        PORT: String(API_PORT),
        NODE_ENV: 'development',
        JOBS_ENABLED: 'false',
        SMS_MODE: 'simulate',
        PUBLIC_WEB_URL: WEB_URL,
        CORS_ORIGIN: WEB_URL,
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: 'Umurongo_frontend',
      url: WEB_URL,
      timeout: 180_000,
      reuseExistingServer: false,
      env: { API_PROXY: `http://localhost:${API_PORT}`, VITE_DEMO_MODE: 'false', VITE_API_URL: '' },
    },
  ],
});
