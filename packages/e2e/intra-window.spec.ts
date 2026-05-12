import { test, expect } from "./fixture";

/** Selector for the draggable tab buttons in mosaic tab bars. */
const TAB_BUTTON = '.tab-button';
/** Selector for mosaic tab group containers. */
const TABS_CONTAINER = ".pane";

test.describe("Intra-window tab activation", () => {
  test("clicking a tab activates it", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const containers = page.locator(TABS_CONTAINER);
    await expect(containers).toHaveCount(2);

    // Click the second tab in the first (left) pane
    const leftContainer = containers.first();
    const leftTabs = leftContainer.locator(TAB_BUTTON);
    await leftTabs.nth(1).click();

    // The tile content should now show the second tab's title
    const contentTitle = page.locator(".content-title").first();
    await expect(contentTitle).toContainText("index.ts");
  });

  test("active tab has .active class", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const containers = page.locator(TABS_CONTAINER);
    const leftContainer = containers.first();
    const leftTabs = leftContainer.locator(TAB_BUTTON);

    // First tab should be active initially
    await expect(leftTabs.first()).toHaveClass(/active/);

    // Click the third tab
    await leftTabs.nth(2).click();

    // Third tab should now be active, first should not
    await expect(leftTabs.nth(2)).toHaveClass(/active/);
    await expect(leftTabs.first()).not.toHaveClass(/active/);
  });
});

test.describe("Intra-window tab drag between panes", () => {
  test("dragging a tab from left pane to right pane moves it", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const containers = page.locator(TABS_CONTAINER);
    await expect(containers).toHaveCount(2);

    const leftContainer = containers.first();
    const rightContainer = containers.last();

    // Initially: 3 tabs in each pane
    const leftTabs = leftContainer.locator(TAB_BUTTON);
    const rightTabs = rightContainer.locator(TAB_BUTTON);
    await expect(leftTabs).toHaveCount(3);
    await expect(rightTabs).toHaveCount(3);

    // Drag the first tab from left pane to right pane's tab bar
    const sourceTab = leftTabs.first();
    const targetTabBar = rightContainer.locator(".tab-bar");

    await sourceTab.dragTo(targetTabBar, { force: true });

    // Left pane should now have 2 tabs, right pane should have 4
    await expect(leftContainer.locator(TAB_BUTTON)).toHaveCount(2);
    await expect(rightContainer.locator(TAB_BUTTON)).toHaveCount(4);
  });

  test("dragged tab appears in the target pane", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const containers = page.locator(TABS_CONTAINER);
    const leftContainer = containers.first();
    const rightContainer = containers.last();

    // Drag first tab from left to right
    const sourceTab = leftContainer.locator(TAB_BUTTON).first();
    const sourceTitle = await sourceTab.textContent();
    const targetTabBar = rightContainer.locator(".tab-bar");
    await sourceTab.dragTo(targetTabBar, { force: true });

    // The dragged tab should appear in the right pane
    const rightTabs = rightContainer.locator(TAB_BUTTON);
    await expect(rightTabs).toHaveCount(4);
    const rightTitles = await rightTabs.evaluateAll(
      (els) => els.map((e) => e.querySelector(".tab-title")?.textContent),
    );
    expect(rightTitles.some((t) => t?.includes(sourceTitle ?? ""))).toBe(true);
  });

  test("dragging tabs from one pane to another preserves all tabs", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    // Verify initial state: 6 tabs across 2 tab groups
    await expect(page.locator(TAB_BUTTON)).toHaveCount(6);
    await expect(page.locator(TABS_CONTAINER)).toHaveCount(2);

    // Drag 2 tabs from first pane to second pane
    const containers = page.locator(TABS_CONTAINER);
    for (let i = 0; i < 2; i++) {
      const tab = containers.first().locator(TAB_BUTTON).first();
      const targetTabBar = containers.last().locator(".tab-bar");
      await tab.dragTo(targetTabBar, { force: true });
      await page.waitForTimeout(500);
    }

    // All 6 tabs should still be present
    await expect(page.locator(TAB_BUTTON)).toHaveCount(6);

    // First pane should have 1 tab, second should have 5
    await expect(containers.first().locator(TAB_BUTTON)).toHaveCount(1);
    await expect(containers.last().locator(TAB_BUTTON)).toHaveCount(5);
  });
});
