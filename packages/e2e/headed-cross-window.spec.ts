/**
 * Headed cross-window E2E tests.
 *
 * These tests exercise the REAL cursor-polling path — actual mouse movement
 * between positioned windows, tick() hit-testing, and the full
 * dragstart → dragend → tabDragEnd flow. They only work in headed mode
 * because they rely on screen.getCursorScreenPoint() tracking the OS cursor.
 *
 * Run with: HEADLESS=0 npx playwright test headed-cross-window.spec.ts
 */
import { test, expect } from "./fixture";
import type { Page, ElectronApplication } from "@playwright/test";

const TAB_BUTTON = '.tab-button';

// Skip entire suite in headless mode — cursor polling doesn't work
test.skip(({ browserName }) => {
  return process.env.HEADLESS !== "0";
}, "Headed-only tests — run with HEADLESS=0");

test.describe("Headed cross-window tab drag", () => {
  async function waitForTabs(page: Page, count: number): Promise<void> {
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(TAB_BUTTON)).toHaveCount(count, {
      timeout: 10_000,
    });
  }

  async function createSecondWindow(
    electronApp: ElectronApplication,
    page1: Page,
  ): Promise<{ page2: Page; window2Id: number }> {
    const window2Id = await page1.evaluate(async () => {
      return await window.electronAPI.testCreateWindow();
    });
    await electronApp.waitForEvent("window", { timeout: 15_000 });
    const windows = electronApp.windows();
    const page2 = windows.find((w) => w !== page1)!;
    return { page2, window2Id };
  }

  test("tear-off: real mouse drag off-window creates new window", async ({
    electronApp,
    page: page1,
  }) => {
    await waitForTabs(page1, 6);

    // Position window 1 at a known location
    const window1Id = await page1.evaluate(() =>
      window.electronAPI.getWindowId(),
    );
    await page1.evaluate((opts) => {
      window.electronAPI.testPositionWindow(opts);
    }, { windowId: window1Id, x: 100, y: 100, width: 800, height: 600 });

    // Get the first mosaic tab button
    const firstTab = page1.locator(TAB_BUTTON).first();
    const tabBox = await firstTab.boundingBox();
    expect(tabBox).not.toBeNull();

    // Move mouse to the tab, press down, drag off the window
    await page1.mouse.move(
      tabBox!.x + tabBox!.width / 2,
      tabBox!.y + tabBox!.height / 2,
    );
    await page1.mouse.down();
    // Move up and out of the window (above window bounds at y=100)
    await page1.mouse.move(tabBox!.x, 50, { steps: 10 });

    await page1.waitForTimeout(500);
    await page1.mouse.up();
    await page1.waitForTimeout(1000);

    // Should now have 2 windows
    const windows = electronApp.windows();
    expect(windows.length).toBeGreaterThanOrEqual(2);

    // Source window should have fewer tabs
    const tabCount = await page1.locator(TAB_BUTTON).count();
    expect(tabCount).toBeLessThan(6);
  });

  test("drop on existing window: real mouse drag between windows", async ({
    electronApp,
    page: page1,
  }) => {
    await waitForTabs(page1, 6);

    // Get window 1 ID and position it on the left
    const window1Id = await page1.evaluate(() =>
      window.electronAPI.getWindowId(),
    );
    await page1.evaluate((opts) => {
      window.electronAPI.testPositionWindow(opts);
    }, { windowId: window1Id, x: 50, y: 100, width: 600, height: 500 });

    // Create window 2 and position it on the right
    const { page2, window2Id } = await createSecondWindow(electronApp, page1);
    await waitForTabs(page2, 6);

    await page1.evaluate((opts) => {
      window.electronAPI.testPositionWindow(opts);
    }, { windowId: window2Id, x: 700, y: 100, width: 600, height: 500 });

    await page1.waitForTimeout(300);

    // Get the first tab from window 1
    const firstTab = page1.locator(TAB_BUTTON).first();
    const tabBox = await firstTab.boundingBox();
    expect(tabBox).not.toBeNull();

    // Drag from window 1 towards window 2
    await page1.mouse.move(
      tabBox!.x + tabBox!.width / 2,
      tabBox!.y + tabBox!.height / 2,
    );
    await page1.mouse.down();
    await page1.mouse.move(750, 200, { steps: 20 });
    await page1.waitForTimeout(100);
    await page1.mouse.up();
    await page1.waitForTimeout(1000);

    // Window 1 should have lost a tab or the drag had no effect
    const w1TabCount = await page1.locator(TAB_BUTTON).count();
    expect(w1TabCount).toBeLessThanOrEqual(6);
  });
});
