import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:4318', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: 'npm run build:sdk && npm run dev -w @house-edge/dashboard -- --port 4318',
    url: 'http://127.0.0.1:4318/api/health',
    reuseExistingServer: false,
    timeout: 180000,
    env: { NEXT_BUILD_DIR: '.next-e2e', SQLITE_PATH: '.data/e2e.db', DATABASE_PROVIDER: 'sqlite', DEMO_MODE: 'true', ADMIN_KEY: '', PUBLIC_URL: 'http://127.0.0.1:4318' },
  },
});
