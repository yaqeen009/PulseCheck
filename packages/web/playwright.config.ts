import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke test.
 *
 * Gated on `PLAYWRIGHT_BASE_URL`: when it is unset the suite is skipped, so CI
 * jobs that only run unit tests are never blocked by a missing app or browser.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
