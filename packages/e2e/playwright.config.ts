import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for Electron E2E tests.
 *
 * Tests launch the Electron app via _electron.launch() which connects
 * through Chrome DevTools Protocol. No browser project is needed —
 * the Electron binary IS the browser.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Known flakiness: Electron headless IPC delivery is ~90% reliable.
  // Single retry covers the remaining ~10% without masking real failures.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  globalTimeout: 5 * 60 * 1000, // 5 min hard cap
  report: [["list"]],

  use: {
    trace: "on-first-retry",
  },
});
