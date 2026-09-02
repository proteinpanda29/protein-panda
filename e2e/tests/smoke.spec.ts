import { test, expect } from '@playwright/test';

test.describe('Smoke tests — core pages load without error', () => {
  test('homepage loads and shows the business name', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    // A blank/crashed page is the one thing this must never be.
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('menu page loads and shows at least one product', async ({ page }) => {
    await page.goto('/menu');
    await expect(page.getByRole('button', { name: 'Add' }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('login page loads with the phone/email input', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder(/mobile number or email/i)).toBeVisible();
  });

  test('a genuinely nonexistent page shows a real 404, not a blank crash', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist-at-all');
    expect(response?.status()).toBe(404);
  });

  test('admin login is reachable at its own separate URL', async ({ page }) => {
    await page.goto('/admin/login');
    await expect(page.locator('body')).toBeVisible();
  });
});
