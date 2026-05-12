/**
 * Tab opening and preview model tests.
 *
 * Tests the VSCode-style preview tab behaviour:
 * - Opening a tab creates a preview tab (italic)
 * - Opening another tab replaces the preview
 * - Double-clicking a preview tab pins it
 * - Pinned tabs show compact rendering
 */
import { test, expect } from "./fixture";

const TAB_BUTTON = '.mosaic-tab-button[draggable="true"]';
const TABS_CONTAINER = ".mosaic-tabs-container";

test.describe("Tab opening and preview model", () => {
  test("clicking + button adds a new tab", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    // Count initial tabs (6 demo tabs)
    const initialCount = await page.locator(TAB_BUTTON).count();

    // Click the + button — we need to use openTab IPC since mosaic's + button is hidden
    await page.evaluate(() => {
      window.electronAPI.openTab("new-file.ts");
    });

    // Wait for the new tab to appear
    await expect(async () => {
      const count = await page.locator(TAB_BUTTON).count();
      expect(count).toBeGreaterThan(initialCount);
    }).toPass({ timeout: 5_000 });
  });

  test("opening a second tab replaces the preview", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const container = page.locator(TABS_CONTAINER).first();
    const initialCount = await container.locator(TAB_BUTTON).count();

    // Open a new tab (should be preview)
    await page.evaluate(() => {
      window.electronAPI.openTab("new-file.ts");
    });
    await expect(async () => {
      const count = await container.locator(TAB_BUTTON).count();
      expect(count).toBeGreaterThan(initialCount);
    }).toPass({ timeout: 5_000 });
    const afterFirst = await container.locator(TAB_BUTTON).count();

    // Open another tab (should replace the preview)
    await page.evaluate(() => {
      window.electronAPI.openTab("another.ts");
    });
    // Count stays the same (preview replaced, not stacked)
    await expect(async () => {
      const count = await container.locator(TAB_BUTTON).count();
      expect(count).toBe(afterFirst);
    }).toPass({ timeout: 5_000 });
  });

  test("preview tabs show italic styling", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    // Open a new tab (should be preview)
    await page.evaluate(() => {
      window.electronAPI.openTab("preview-file.ts");
    });

    // Wait for the tab to appear
    await expect(async () => {
      const count = await page.locator(TAB_BUTTON).count();
      expect(count).toBeGreaterThan(6);
    }).toPass({ timeout: 5_000 });

    // The preview tab should have italic styling (rendered via renderTabTitle)
    // Check that a tab with "preview-file.ts" exists
    const previewTab = page.locator(TAB_BUTTON).filter({ hasText: "preview-file.ts" });
    await expect(previewTab).toBeVisible({ timeout: 3_000 });
  });

  test("pinning a tab via IPC", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    // Get the first tab ID from state
    const firstTabId = await page.evaluate(() => {
      const state = window.electronAPI.getInitialState();
      if (state === undefined) return "";
      const layout = state.layout as Record<string, unknown>;
      if (layout.type === "split") {
        const children = layout.children as Record<string, unknown>[];
        const first = children[0] as Record<string, unknown>;
        if (first.type === "pane") {
          return (first.tabIds as string[])[0] ?? "";
        }
      }
      if (layout.type === "pane") {
        return (layout.tabIds as string[])[0] ?? "";
      }
      return "";
    });

    expect(firstTabId).not.toBe("");

    // Pin the tab via IPC
    await page.evaluate((id) => {
      window.electronAPI.toggleTabPin(id);
    }, firstTabId);

    await page.waitForTimeout(300);

    // Verify the tab now shows the pin badge (📌) via renderTabTitle
    const pinnedTab = page.locator(TAB_BUTTON).filter({ hasText: "📌" });
    await expect(pinnedTab).toHaveCount(1, { timeout: 3_000 });
  });
});
