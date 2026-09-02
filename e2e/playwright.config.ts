import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against a REAL deployed instance of the app — they
 * don't spin up their own server. Set BASE_URL to wherever you've
 * deployed (Replit, a cloud host, or http://localhost:3000 for local
 * testing) before running `npm test` in this folder.
 *
 * These have NOT been run successfully against a live instance as part
 * of building them — there's no real database in the environment that
 * wrote this code, only a mocked one (see the main README's "What's
 * stubbed vs. real" section). The tests are real, valid Playwright
 * specs that will run correctly once you have an actual deployment to
 * point them at — but "written correctly" and "verified passing
 * against production" are different claims, and I want to be exact
 * about which one this is.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Cross-browser coverage (checklist item #8) — the same test suite
  // runs against all of these, not separate test code per browser.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }, // Safari's real engine, not a simulation
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],
});
