import { test, expect } from "./fixture";

/** Selector for the draggable tab buttons in mosaic tab bars. */
const TAB_BUTTON = '.mosaic-tab-button[draggable="true"]';
/** Selector for mosaic tab group containers. */
const TABS_CONTAINER = ".mosaic-tabs-container";

/**
 * Perform a precise drag using page.mouse for react-dnd compatibility.
 * React-dnd's HTML5 backend needs proper mousedown/mousemove/mouseup sequences.
 */
async function dragTab(
  page: import("@playwright/test").Page,
  source: import("@playwright/test").Locator,
  target: import("@playwright/test").Locator,
): Promise<void> {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (sourceBox === null || targetBox === null) return;

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Move in steps so react-dnd tracks the drag
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      startX + (endX - startX) * (i / steps),
      startY + (endY - startY) * (i / steps),
    );
  }
  await page.mouse.up();
}

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

  test("active tab has .-active class", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const containers = page.locator(TABS_CONTAINER);
    const leftContainer = containers.first();
    const leftTabs = leftContainer.locator(TAB_BUTTON);

    // First tab should be active initially
    await expect(leftTabs.first()).toHaveClass(/-active/);

    // Click the third tab
    await leftTabs.nth(2).click();

    // Third tab should now be active, first should not
    await expect(leftTabs.nth(2)).toHaveClass(/-active/);
    await expect(leftTabs.first()).not.toHaveClass(/-active/);
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
    const targetTabBar = rightContainer.locator(".mosaic-tab-bar.draggable");

    await dragTab(page, sourceTab, targetTabBar);

    // Left pane should now have 2 tabs, right pane should have 4
    await expect(leftContainer.locator(TAB_BUTTON)).toHaveCount(2);
    await expect(rightContainer.locator(TAB_BUTTON)).toHaveCount(4);
  });

  test("dragging a tab to a specific position inserts before that tab", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const containers = page.locator(TABS_CONTAINER);
    const leftContainer = containers.first();
    const rightContainer = containers.last();

    // Get the title of the first tab in the left pane (README.md)
    const sourceTab = leftContainer.locator(TAB_BUTTON).first();
    const sourceTitle = await sourceTab.textContent();

    // Drag to the second tab in the right pane (should insert before it)
    const targetTab = rightContainer.locator(TAB_BUTTON).nth(1);
    await dragTab(page, sourceTab, targetTab);

    // Right pane should now have 4 tabs
    await expect(rightContainer.locator(TAB_BUTTON)).toHaveCount(4);

    // The dragged tab should be at index 1 in the right pane (inserted before the original second tab)
    const rightTabsAfter = rightContainer.locator(TAB_BUTTON);
    const insertedTabText = await rightTabsAfter.nth(1).textContent();
    expect(insertedTabText).toContain(sourceTitle ?? "");
  });

  test("dragging all tabs out of a pane removes it", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const containers = page.locator(TABS_CONTAINER);
    const leftContainer = containers.first();
    const rightContainer = containers.last();

    // Drag all 3 tabs from left pane to right pane
    for (let i = 0; i < 3; i++) {
      const tab = leftContainer.locator(TAB_BUTTON).first();
      const targetTabBar = rightContainer.locator(".mosaic-tab-bar.draggable");
      await dragTab(page, tab, targetTabBar);
    }

    // Left pane should be gone — only 1 tab group remains
    await expect(page.locator(TABS_CONTAINER)).toHaveCount(1);
    // That single tab group should have all 6 tabs
    await expect(page.locator(TABS_CONTAINER).locator(TAB_BUTTON)).toHaveCount(6);
  });

  test("dropped tab becomes the active tab in the target pane", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const containers = page.locator(TABS_CONTAINER);
    const leftContainer = containers.first();
    const rightContainer = containers.last();

    // Drag first tab from left to right
    const sourceTab = leftContainer.locator(TAB_BUTTON).first();
    const targetTabBar = rightContainer.locator(".mosaic-tab-bar.draggable");
    await dragTab(page, sourceTab, targetTabBar);

    // The dropped tab should be active in the right pane
    const rightTabs = rightContainer.locator(TAB_BUTTON);
    const activeTab = rightTabs.locator(".-active");
    await expect(activeTab).toContainText("README.md");
  });
});
