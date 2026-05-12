import { test, expect } from "./fixture";

const TAB_BUTTON = '.mosaic-tab-button[draggable="true"]';
const TABS_CONTAINER = ".mosaic-tabs-container";

test.describe("Tab reordering within a pane", () => {
  test("tab count stays the same after reordering", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const container = page.locator(TABS_CONTAINER).first();
    const tabs = container.locator(TAB_BUTTON);
    await expect(tabs).toHaveCount(3);

    // Drag first tab to second tab position (react-dnd handles reorder)
    await tabs.nth(0).dragTo(tabs.nth(1), { force: true });

    // Still 3 tabs in the pane
    await expect(tabs).toHaveCount(3);
  });

  test("reordering changes tab order", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    const container = page.locator(TABS_CONTAINER).first();
    const tabs = container.locator(TAB_BUTTON);

    // Initial order: README.md, index.ts, styles.css
    const initialTitles = await tabs.evaluateAll(
      (els) => els.map((e) => e.querySelector(".mosaic-tab-label")?.textContent),
    );
    expect(initialTitles[0]).toContain("README.md");

    // Drag last tab to first position
    await tabs.nth(2).dragTo(tabs.nth(0), { force: true });
    await page.waitForTimeout(300);

    // Order should have changed (last tab moved somewhere)
    const reorderedTitles = await tabs.evaluateAll(
      (els) => els.map((e) => e.querySelector(".mosaic-tab-label")?.textContent),
    );
    // Still 3 tabs, but order changed
    expect(reorderedTitles.length).toBe(3);
    // The first title should no longer be the same as the initial first
    // (mosaic may have reordered differently, but something should have changed)
    const stillSame =
      reorderedTitles[0] === initialTitles[0] &&
      reorderedTitles[1] === initialTitles[1] &&
      reorderedTitles[2] === initialTitles[2];
    expect(stillSame).toBe(false);
  });
});

test.describe("Dynamic pane splitting", () => {
  test("mosaic split handle exists between panes", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    // The mosaic-split divider should be visible
    const split = page.locator(".mosaic-split");
    await expect(split).toHaveCount(1);
    await expect(split).toBeVisible();
  });

  test("dragging a tab to a different pane creates a split", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    // Initially: 2 tab group containers (left + right)
    const containers = page.locator(TABS_CONTAINER);
    await expect(containers).toHaveCount(2);

    // Drag a tab from left to right
    const leftContainer = containers.first();
    const rightContainer = containers.last();
    const sourceTab = leftContainer.locator(TAB_BUTTON).first();
    const targetTabBar = rightContainer.locator(".mosaic-tab-bar.draggable");

    await sourceTab.dragTo(targetTabBar, { force: true });

    // Right pane should have 4 tabs, left should have 2
    await expect(rightContainer.locator(TAB_BUTTON)).toHaveCount(4);
    await expect(leftContainer.locator(TAB_BUTTON)).toHaveCount(2);
  });

  test("split handles are draggable", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(TAB_BUTTON).first().waitFor({ timeout: 10_000 });

    // Get the initial tile positions
    const tiles = page.locator(".mosaic-tile");
    await expect(tiles).toHaveCount(2);

    const firstTileBefore = await tiles.first().evaluate((el) => ({
      width: el.getBoundingClientRect().width,
    }));

    // Drag the split handle to resize
    const split = page.locator(".mosaic-split").first();
    const splitBox = await split.boundingBox();
    expect(splitBox).not.toBeNull();

    // Drag split handle 50px to the right
    await page.mouse.move(splitBox!.x + splitBox!.width / 2, splitBox!.y + splitBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(splitBox!.x + splitBox!.width / 2 + 50, splitBox!.y + splitBox!.height / 2, { steps: 5 });
    await page.mouse.up();

    // Tile widths should have changed
    const firstTileAfter = await tiles.first().evaluate((el) => ({
      width: el.getBoundingClientRect().width,
    }));
    expect(firstTileAfter.width).not.toBe(firstTileBefore.width);
  });
});
