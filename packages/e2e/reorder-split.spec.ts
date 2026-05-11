import { test, expect } from "./fixture";

test.describe("Tab reordering within a pane", () => {
  test("dragging a tab to a later position in the same tab bar reorders it", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const pane = page.locator("[data-testid='pane']").first();
    const tabs = pane.locator("[data-testid='tab']");

    // Initial order: README.md, index.ts, styles.css
    await expect(tabs.nth(0)).toContainText("README.md");
    await expect(tabs.nth(1)).toContainText("index.ts");
    await expect(tabs.nth(2)).toContainText("styles.css");

    // Drag first tab (README.md) past the second tab
    const source = tabs.nth(0);
    const target = tabs.nth(1);

    await source.dragTo(target);

    // README.md should now be at index 1 (swapped with index.ts)
    const reordered = pane.locator("[data-testid='tab']");
    await expect(reordered.nth(0)).toContainText("index.ts");
    await expect(reordered.nth(1)).toContainText("README.md");
    await expect(reordered.nth(2)).toContainText("styles.css");
  });

  test("dragging the last tab to the first position reorders it", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const pane = page.locator("[data-testid='pane']").first();
    const tabs = pane.locator("[data-testid='tab']");

    // Use low-level mouse drag to avoid cross-pane matching
    // Drag last tab (styles.css) to the position of the first tab (README.md)
    const lastBox = await tabs.nth(2).boundingBox();
    const firstBox = await tabs.nth(0).boundingBox();
    expect(lastBox).not.toBeNull();
    expect(firstBox).not.toBeNull();

    // Hover on last tab, start drag, move to first tab position, drop
    await page.mouse.move(lastBox!.x + lastBox!.width / 2, lastBox!.y + lastBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(firstBox!.x + firstBox!.width / 2, firstBox!.y + firstBox!.height / 2, { steps: 5 });
    await page.mouse.up();

    // Wait for reorder to process
    await page.waitForTimeout(500);

    const reordered = pane.locator("[data-testid='tab']");
    await expect(reordered.nth(0)).toContainText("styles.css");
    await expect(reordered.nth(1)).toContainText("README.md");
    await expect(reordered.nth(2)).toContainText("index.ts");
  });

  test("tab count stays the same after reordering", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const pane = page.locator("[data-testid='pane']").first();
    const tabs = pane.locator("[data-testid='tab']");
    await expect(tabs).toHaveCount(3);

    // Reorder within the first pane: drag first tab to the second tab
    await tabs.nth(0).dragTo(tabs.nth(1));

    // Still 3 tabs in the pane
    await expect(tabs).toHaveCount(3);
  });
});

test.describe("Dynamic pane splitting", () => {
  test("dragging a tab from another pane to the split zone splits it horizontally", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    await expect(page.locator("[data-testid='pane']")).toHaveCount(2);

    const leftPane = page.locator("[data-testid='pane']").first();
    const rightPane = page.locator("[data-testid='pane']").last();
    const rightSplitZone = rightPane.locator("[data-testid='split-zone-right']");

    // Drag from left pane to right pane's split zone
    const tab = leftPane.locator("[data-testid='tab']").first();
    const tabBox = await tab.boundingBox();
    expect(tabBox).not.toBeNull();

    await page.mouse.move(tabBox!.x + tabBox!.width / 2, tabBox!.y + tabBox!.height / 2);
    await page.mouse.down();
    // Move to trigger drag start
    await page.mouse.move(tabBox!.x, tabBox!.y - 10, { steps: 3 });

    // Move to right pane — split zone should appear
    const rightBox = await rightPane.boundingBox();
    expect(rightBox).not.toBeNull();
    await page.mouse.move(rightBox!.x + rightBox!.width / 2, rightBox!.y + rightBox!.height / 2, { steps: 5 });
    await expect(rightSplitZone).toBeVisible({ timeout: 5000 });

    // Drop on split zone
    const zoneBox = await rightSplitZone.boundingBox();
    expect(zoneBox).not.toBeNull();
    await page.mouse.move(zoneBox!.x + zoneBox!.width / 2, zoneBox!.y + zoneBox!.height / 2);
    await page.mouse.up();

    // Should now have 3 panes (right pane split into two)
    await expect(page.locator("[data-testid='pane']")).toHaveCount(3);

    // The new split should be horizontal (row)
    const splits = page.locator("[data-testid='split']");
    const directions: string[] = [];
    const splitCount = await splits.count();
    for (let i = 0; i < splitCount; i++) {
      const dir = await splits.nth(i).getAttribute("data-direction");
      if (dir !== null) directions.push(dir);
    }
    expect(directions).toContain("row");
  });

  test("dragging a tab from another pane to the bottom split zone splits it vertically", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const leftPane = page.locator("[data-testid='pane']").first();
    const rightPane = page.locator("[data-testid='pane']").last();
    const rightSplitZone = rightPane.locator("[data-testid='split-zone-bottom']");

    const tab = leftPane.locator("[data-testid='tab']").first();
    const tabBox = await tab.boundingBox();
    expect(tabBox).not.toBeNull();

    await page.mouse.move(tabBox!.x + tabBox!.width / 2, tabBox!.y + tabBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(tabBox!.x, tabBox!.y - 10, { steps: 3 });

    const rightBox = await rightPane.boundingBox();
    expect(rightBox).not.toBeNull();
    await page.mouse.move(rightBox!.x + rightBox!.width / 2, rightBox!.y + rightBox!.height / 2, { steps: 5 });
    await expect(rightSplitZone).toBeVisible({ timeout: 5000 });

    const zoneBox = await rightSplitZone.boundingBox();
    expect(zoneBox).not.toBeNull();
    await page.mouse.move(zoneBox!.x + zoneBox!.width / 2, zoneBox!.y + zoneBox!.height / 2);
    await page.mouse.up();

    await expect(page.locator("[data-testid='pane']")).toHaveCount(3);
    const splits = page.locator("[data-testid='split']");
    const directions: string[] = [];
    const splitCount = await splits.count();
    for (let i = 0; i < splitCount; i++) {
      const dir = await splits.nth(i).getAttribute("data-direction");
      if (dir !== null) directions.push(dir);
    }
    expect(directions).toContain("column");
  });

  test("split zone only appears during drag", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const pane = page.locator("[data-testid='pane']").first();
    const splitZoneRight = pane.locator("[data-testid='split-zone-right']");
    const splitZoneBottom = pane.locator("[data-testid='split-zone-bottom']");

    // Split zones should not be visible before drag starts
    await expect(splitZoneRight).not.toBeVisible();
    await expect(splitZoneBottom).not.toBeVisible();
  });
});
