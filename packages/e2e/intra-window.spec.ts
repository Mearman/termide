import { test, expect } from "./fixture";

test.describe("Intra-window tab activation", () => {
  test("clicking a tab activates it", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    // Find the second pane's tabs
    const panes = page.locator("[data-testid='pane']");
    await expect(panes).toHaveCount(2);

    // Click the second tab in the first pane
    const firstPane = panes.first();
    const tabs = firstPane.locator("[data-testid='tab']");
    await tabs.nth(1).click();

    // The tab content should now show the second tab's title
    const content = firstPane.locator("[data-testid='tab-content']");
    await expect(content).toContainText("index.ts");
  });

  test("active tab has .active class", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const panes = page.locator("[data-testid='pane']");
    const firstPane = panes.first();
    const tabs = firstPane.locator("[data-testid='tab']");

    // First tab should be active initially
    await expect(tabs.first()).toHaveClass(/active/);

    // Click the third tab
    await tabs.nth(2).click();

    // Third tab should now be active, first should not
    await expect(tabs.nth(2)).toHaveClass(/active/);
    await expect(tabs.first()).not.toHaveClass(/active/);
  });
});

test.describe("Intra-window tab drag between panes", () => {
  test("dragging a tab from left pane to right pane moves it", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const panes = page.locator("[data-testid='pane']");
    await expect(panes).toHaveCount(2);

    const leftPane = panes.first();
    const rightPane = panes.last();

    // Initially: 3 tabs in each pane
    await expect(leftPane.locator("[data-testid='tab']")).toHaveCount(3);
    await expect(rightPane.locator("[data-testid='tab']")).toHaveCount(3);

    // Drag the first tab from left pane and drop on right pane's tab bar
    const sourceTab = leftPane.locator("[data-testid='tab']").first();
    const targetTabBar = rightPane.locator("[data-testid='tab-bar']");

    await sourceTab.dragTo(targetTabBar);

    // Left pane should now have 2 tabs, right pane should have 4
    await expect(leftPane.locator("[data-testid='tab']")).toHaveCount(2);
    await expect(rightPane.locator("[data-testid='tab']")).toHaveCount(4);
  });

  test("dragging a tab to a specific position inserts before that tab", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const panes = page.locator("[data-testid='pane']");
    const leftPane = panes.first();
    const rightPane = panes.last();

    // Get the title of the first tab in the left pane (README.md)
    const sourceTab = leftPane.locator("[data-testid='tab']").first();
    const sourceTitle = await sourceTab.textContent();

    // Drag to the second tab in the right pane (should insert before it)
    const targetTab = rightPane.locator("[data-testid='tab']").nth(1);
    await sourceTab.dragTo(targetTab);

    // Right pane should now have 4 tabs
    await expect(rightPane.locator("[data-testid='tab']")).toHaveCount(4);

    // The dragged tab should be at index 1 in the right pane (inserted before the original second tab)
    const rightTabs = rightPane.locator("[data-testid='tab']");
    const insertedTabText = await rightTabs.nth(1).textContent();
    expect(insertedTabText).toBe(sourceTitle);
  });

  test("dragging all tabs out of a pane removes it", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const panes = page.locator("[data-testid='pane']");
    const leftPane = panes.first();
    const rightPane = panes.last();

    // Drag all 3 tabs from left pane to right pane
    for (let i = 0; i < 3; i++) {
      const tab = leftPane.locator("[data-testid='tab']").first();
      const targetTabBar = rightPane.locator("[data-testid='tab-bar']");
      await tab.dragTo(targetTabBar);
    }

    // Left pane should be gone — only 1 pane remains
    await expect(page.locator("[data-testid='pane']")).toHaveCount(1);
    // That single pane should have all 6 tabs
    await expect(page.locator("[data-testid='pane']").locator("[data-testid='tab']")).toHaveCount(6);
  });

  test("dropped tab becomes the active tab in the target pane", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='tab']").first().waitFor({ timeout: 10_000 });

    const panes = page.locator("[data-testid='pane']");
    const leftPane = panes.first();
    const rightPane = panes.last();

    // Drag first tab from left to right
    const sourceTab = leftPane.locator("[data-testid='tab']").first();
    const targetTabBar = rightPane.locator("[data-testid='tab-bar']");
    await sourceTab.dragTo(targetTabBar);

    // The dropped tab should be active in the right pane
    // The dropped tab was README.md (the first tab from left)
    const droppedTab = rightPane.locator("[data-testid='tab']").filter({ hasText: "README.md" });
    await expect(droppedTab).toHaveClass(/active/);
  });
});
