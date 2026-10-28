import { defineConfig, devices } from '@playwright/test';

// Browser tests run against the real app with the built dashboard.
// `npm run test:e2e` builds first. Firefox is what you use day to day.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4799',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node tests/e2e/serve.ts',
    url: 'http://127.0.0.1:4799/api/v1/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
