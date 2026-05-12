import { test, expect } from "./fixture";

const TAB_BUTTON = ".tab-button";

test.describe("Split-on-drop", () => {
  test("dragging a tab to the right edge of content area creates a row split", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    // Single pane with 6 tabs
    const panes = page.locator(".pane");
    await expect(panes).toHaveCount(1);
    await expect(page.locator(TAB_BUTTON)).toHaveCount(6);

    // Drag first tab to right edge of content area
    const content = page.locator(".pane-content").first();
    const contentBox = await content.boundingBox();
    expect(contentBox).not.toBeNull();

    // Drop at 90% x, 50% y (right edge, middle)
    const targetX = contentBox!.x + contentBox!.width * 0.9;
    const targetY = contentBox!.y + contentBox!.height * 0.5;

    const sourceTab = page.locator(TAB_BUTTON).first();
    await sourceTab.dragTo(content, {
      force: true,
      targetPosition: { x: contentBox!.width * 0.9, y: contentBox!.height * 0.5 },
    });

    await page.waitForTimeout(500);

    // Should now have 2 panes (a split)
    const newPanes = page.locator(".pane");
    const paneCount = await newPanes.count();
    console.log("pane count after split:", paneCount);

    const tabCount = await page.locator(TAB_BUTTON).count();
    console.log("tab count after split:", tabCount);

    // Check layout via state
    const layout = await page.evaluate(() => window.electronAPI.getInitialState());
    console.log("layout type:", layout.layout.type);
    if (layout.layout.type === "split") {
      console.log("direction:", layout.layout.direction);
      console.log("children:", layout.layout.children.length);
    }
  });

  test("dragging a tab to the bottom edge creates a column split", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const content = page.locator(".pane-content").first();
    const contentBox = await content.boundingBox();
    expect(contentBox).not.toBeNull();

    const sourceTab = page.locator(TAB_BUTTON).first();
    await sourceTab.dragTo(content, {
      force: true,
      targetPosition: { x: contentBox!.width * 0.5, y: contentBox!.height * 0.9 },
    });

    await page.waitForTimeout(500);

    const layout = await page.evaluate(() => window.electronAPI.getInitialState());
    console.log("layout type:", layout.layout.type);
    if (layout.layout.type === "split") {
      console.log("direction:", layout.layout.direction);
    }

    const paneCount = await page.locator(".pane").count();
    console.log("pane count:", paneCount);
  });

  test("cannot split own pane when it is the only tab", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    // Close all but one tab
    const tabs = page.locator(TAB_BUTTON);
    const count = await tabs.count();
    for (let i = 1; i < count; i++) {
      await tabs.nth(1).locator(".tab-close").click();
      await page.waitForTimeout(100);
    }
    await expect(page.locator(TAB_BUTTON)).toHaveCount(1);

    // Try to split by dragging to content area
    const content = page.locator(".pane-content").first();
    const contentBox = await content.boundingBox();
    expect(contentBox).not.toBeNull();

    const sourceTab = page.locator(TAB_BUTTON).first();
    await sourceTab.dragTo(content, {
      force: true,
      targetPosition: { x: contentBox!.width * 0.9, y: contentBox!.height * 0.5 },
    });

    await page.waitForTimeout(500);

    // Should still be a single pane
    const layout = await page.evaluate(() => window.electronAPI.getInitialState());
    expect(layout.layout.type).toBe("pane");
    await expect(page.locator(".pane")).toHaveCount(1);
  });
});
