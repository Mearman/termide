/**
 * Tab opening and preview model tests.
 *
 * Tests the VSCode-style preview tab behaviour:
 * - Opening a tab creates a preview tab (italic)
 * - Opening another tab replaces the preview
 * - Double-clicking a preview tab pins it
 * - Pinned tabs are compact (icon-only)
 * - New tab button (+) opens a tab
 */
import { test, expect } from "./fixture";

test.describe("Tab opening and preview model", () => {
  test("clicking + button adds a new tab", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    // Count initial tabs (6 demo tabs)
    const initialCount = await page.locator("[data-testid='tab']").count();

    // Click the + button in the first pane
    const firstPane = page.locator("[data-testid='pane']").first();
    await firstPane.locator(".tab-new-button").click();

    // Wait for the new tab to appear
    await expect(async () => {
      const count = await page.locator("[data-testid='tab']").count();
      expect(count).toBeGreaterThan(initialCount);
    }).toPass({ timeout: 5_000 });

    // The new tab should be active in the first pane
    const activeTab = firstPane.locator("[data-testid='tab'].active");
    await expect(activeTab).toBeVisible({ timeout: 3_000 });
  });

  test("opening a second tab replaces the preview", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const firstPane = page.locator("[data-testid='pane']").first();
    const initialCount = await firstPane.locator("[data-testid='tab']").count();

    // Open a new tab (should be preview)
    await firstPane.locator(".tab-new-button").click();
    await expect(async () => {
      const count = await firstPane.locator("[data-testid='tab']").count();
      expect(count).toBeGreaterThan(initialCount);
    }).toPass({ timeout: 5_000 });
    const afterFirst = await firstPane.locator("[data-testid='tab']").count();

    // Open another tab (should replace the preview)
    await firstPane.locator(".tab-new-button").click();
    // Count stays the same (preview replaced, not stacked)
    await expect(async () => {
      const count = await firstPane.locator("[data-testid='tab']").count();
      expect(count).toBe(afterFirst);
    }).toPass({ timeout: 5_000 });
  });

  test("double-clicking a preview tab pins it", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const firstPane = page.locator("[data-testid='pane']").first();

    // Open a new tab (preview)
    await firstPane.locator(".tab-new-button").click();
    await expect(firstPane.locator("[data-testid='tab'].preview")).toHaveCount(1, {
      timeout: 5_000,
    });

    // Double-click the preview tab to pin it
    const previewTab = firstPane.locator("[data-testid='tab'].preview");
    await previewTab.dblclick();

    // Wait for state update
    await page.waitForTimeout(300);

    // The tab should now be pinned (has .pinned class) and not preview
    const pinnedTabs = firstPane.locator("[data-testid='tab'].pinned");
    const previewTabs = firstPane.locator("[data-testid='tab'].preview");
    await expect(pinnedTabs).toHaveCount(1);
    await expect(previewTabs).toHaveCount(0);
  });

  test("pinned tabs are compact (38px wide)", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const firstPane = page.locator("[data-testid='pane']").first();

    // Double-click the first tab to pin it
    const firstTab = firstPane.locator("[data-testid='tab']").first();
    await firstTab.dblclick();
    await page.waitForTimeout(300);

    // The tab should now have the pinned class
    const pinnedTab = firstPane.locator("[data-testid='tab'].pinned");
    await expect(pinnedTab).toHaveCount(1);

    // Pinned tabs are compact: 38px
    const width = await pinnedTab.evaluate((el) => el.offsetWidth);
    expect(width).toBe(38);
  });

  test("separator appears between pinned and unpinned tabs", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const firstPane = page.locator("[data-testid='pane']").first();

    // Pin the first tab
    await firstPane.locator("[data-testid='tab']").first().dblclick();
    await page.waitForTimeout(300);

    // Should now have a separator
    const separator = firstPane.locator(".tab-separator");
    await expect(separator).toHaveCount(1);
  });
});
