import { test, expect } from '@playwright/test';

/**
 * A REAL end-user identifier for this test run. Using a fixed number
 * repeatedly is fine here specifically because E2E_TEST_MODE (see
 * backend/src/auth/auth.service.ts) accepts a fixed bypass code
 * regardless of which real OTP was actually sent — the identifier
 * itself doesn't need to be unique per run.
 */
const TEST_PHONE = '+919999000001';
const E2E_OTP = '000000';

test.describe('Full customer journey: login → menu → cart → checkout', () => {
  test('a customer can log in, order a product, and reach order confirmation', async ({ page }) => {
    // ---- 1. Login ----
    await page.goto('/login');
    await page.getByPlaceholder(/mobile number or email/i).fill(TEST_PHONE);
    await page.getByRole('button', { name: 'Send OTP' }).click();

    // The OTP input step should appear once a code has been "sent" —
    // in a real deployment with E2E_TEST_MODE=true, any dispatched code
    // is irrelevant; the fixed bypass code below is what actually gets
    // accepted server-side.
    await page.getByPlaceholder('••••••').fill(E2E_OTP);
    await page.getByRole('button', { name: /Verify & Continue/ }).click();

    // Successful login should redirect away from the login page.
    await expect(page).not.toHaveURL(/\/login/);

    // ---- 2. Browse the menu and add an item to cart ----
    await page.goto('/menu');
    const firstProductCard = page.locator('main').getByRole('button', { name: 'Add' }).first();
    await expect(firstProductCard).toBeVisible({ timeout: 15_000 });
    await firstProductCard.click();

    // ---- 3. Go to checkout ----
    await page.goto('/checkout');
    await expect(page.getByText(/Pickup|Delivery/i).first()).toBeVisible();

    // Cash is the payment method that doesn't require a real payment
    // gateway round-trip — the right choice for an automated E2E check
    // that shouldn't depend on Razorpay's own sandbox being configured.
    const cashOption = page.getByText('CASH', { exact: false }).first();
    if (await cashOption.isVisible().catch(() => false)) {
      await cashOption.click();
    }

    const placeOrderButton = page.getByRole('button', { name: /Place Order/ });
    await expect(placeOrderButton).toBeVisible();
    await placeOrderButton.click();

    // ---- 4. Confirm the order actually went through ----
    // A real order number appearing is the strongest signal the whole
    // pipeline — auth, cart, checkout, order creation — worked end to
    // end, not just that individual pages rendered.
    await expect(page.getByText(/Order #|order placed|thank you/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
