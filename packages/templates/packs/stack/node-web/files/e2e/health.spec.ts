import { expect, test } from '@playwright/test';

test('health endpoint answers @smoke', async ({ request }) => {
  const res = await request.get('/health');
  expect([200, 503]).toContain(res.status());
});

test('home page shows the health status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('health-status')).not.toHaveText('checking…');
});
