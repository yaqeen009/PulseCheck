import { expect, test } from '@playwright/test';

/**
 * Register → create a monitor → see it in the list.
 *
 * Runs against a real server and a real database, so it is opt-in: set
 * `PLAYWRIGHT_BASE_URL` (for example `http://localhost:5273`) and start both the
 * API and the Vite dev server first.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL;

test.describe('PulseCheck smoke', () => {
  test.skip(!baseURL, 'PLAYWRIGHT_BASE_URL is not set: skipping the live end-to-end smoke test');

  test('a new account can register and create a monitor', async ({ page }) => {
    const unique = Date.now();
    const email = `smoke+${unique}@example.com`;
    const password = `smoke-password-${unique}`;
    const monitorName = `Smoke monitor ${unique}`;

    await page.goto('/register');

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('No monitors yet')).toBeVisible();

    await page.getByRole('link', { name: /new monitor/i }).click();
    await expect(page.getByRole('heading', { name: 'New monitor' })).toBeVisible();

    await page.getByLabel('Name').fill(monitorName);
    await page.getByLabel('URL').fill('https://example.com/');
    await page.getByRole('button', { name: 'Create monitor' }).click();

    await expect(page.getByRole('heading', { name: monitorName })).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Monitors' })
      .click();
    const row = page.getByRole('row', { name: new RegExp(monitorName) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Pending')).toBeVisible();
  });
});
