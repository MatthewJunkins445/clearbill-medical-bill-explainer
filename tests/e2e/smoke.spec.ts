import { expect, test } from '@playwright/test';

test('app shell renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('ClearBill');
  await expect(page.getByRole('heading', { name: 'ClearBill' })).toBeVisible();
});
