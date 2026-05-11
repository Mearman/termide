/**
 * Cross-window tab drag E2E tests.
 *
 * Cross-window dragging relies on OS-level cursor tracking which doesn't
 * work in headless Electron. Tests use the test-only IPC APIs to
 * programmatically control the drag coordinator's target window, then
 * trigger the cross-window drop path via the normal IPC flow.
 *
 * The entire cross-window drag flow is driven via IPC (tabDragBegin,
 * testSetDragTarget, tabDragEnd) rather than HTML5 DnD + mouse simulation.
 * This avoids the headless DnD limitations while still testing the
 * main-process state management end-to-end.
 */
import { test, expect } from "./fixture";
import type { Page, ElectronApplication } from "@playwright/test";

test.describe("Cross-window tab drag", () => {
  /**
   * Helper: wait for a page to have tabs rendered.
   */
  async function waitForTabs(page: Page, count: number): Promise<void> {
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("[data-testid='tab']")).toHaveCount(count, {
      timeout: 10_000,
    });
  }

  /**
   * Helper: create a second Electron window and return its page.
   */
  async function createSecondWindow(
    electronApp: ElectronApplication,
    page1: Page,
  ): Promise<{ page2: Page; window2Id: number }> {
    const window2Id = await page1.evaluate(async () => {
      return await window.electronAPI.testCreateWindow();
    });
    await electronApp.waitForEvent("window", { timeout: 15_000 });
    const windows = electronApp.windows();
    // Find the page that isn't page1
    const page2 = windows.find((w) => w !== page1)!;
    return { page2, window2Id };
  }

  test("creating a second window gives it its own state", async ({
    electronApp,
    page: page1,
  }) => {
    await waitForTabs(page1, 6);

    const { page2 } = await createSecondWindow(electronApp, page1);
    await waitForTabs(page2, 6);

    // Both windows should have independent state with 2 panes each
    await expect(page1.locator("[data-testid='pane']")).toHaveCount(2);
    await expect(page2.locator("[data-testid='pane']")).toHaveCount(2);
  });

  test("tear-off: drag ends outside all windows creates a new window with the tab", async ({
    electronApp,
    page: page1,
  }) => {
    await waitForTabs(page1, 6);

    // Get the first tab's ID and title
    const firstTab = page1.locator("[data-testid='tab']").first();
    const tabTitle = await firstTab.textContent();
    const tabId = await firstTab.getAttribute("data-tab-id");
    expect(tabId).not.toBeNull();

    // Drive the cross-window drag via IPC only
    // 1. Begin drag (from window 1)
    await page1.evaluate((id) => {
      window.electronAPI.tabDragBegin({
        windowId: 1,
        tabId: id,
        tabTitle: "test",
        tabColour: "#fff",
        tabBounds: { x: 0, y: 0, width: 100, height: 30 },
      });
    }, tabId);

    // 2. End drag as cross-window with no target (tear-off)
    await page1.evaluate(() => {
      window.electronAPI.tabDragEnd(true);
    });

    // Wait for new window
    await electronApp.waitForEvent("window", { timeout: 15_000 });

    // The new window should have exactly 1 tab — the torn-off one
    const windows = electronApp.windows();
    const page2 = windows.find((w) => w !== page1)!;
    await waitForTabs(page2, 1);
    const newTabTitle = await page2
      .locator("[data-testid='tab']")
      .first()
      .textContent();
    expect(newTabTitle).toBe(tabTitle);

    // The source window should have lost the tab (5 remaining)
    await expect(page1.locator("[data-testid='tab']")).toHaveCount(5);
  });

  test("drop on existing window: tab moves between windows", async ({
    electronApp,
    page: page1,
  }) => {
    await waitForTabs(page1, 6);

    // Create a second window
    const { page2, window2Id } = await createSecondWindow(electronApp, page1);
    await waitForTabs(page2, 6);

    // Get the first tab from window 1
    const firstTab = page1.locator("[data-testid='tab']").first();
    const tabTitle = await firstTab.textContent();
    const tabId = await firstTab.getAttribute("data-tab-id");
    expect(tabId).not.toBeNull();

    // Drive the cross-window drag via IPC
    // 1. Begin drag (from window 1)
    await page1.evaluate((id) => {
      window.electronAPI.tabDragBegin({
        windowId: 1,
        tabId: id,
        tabTitle: "test",
        tabColour: "#fff",
        tabBounds: { x: 0, y: 0, width: 100, height: 30 },
      });
    }, tabId);

    await page1.waitForTimeout(100);

    // 2. Set the drag target to window 2 (simulates cursor entering window 2)
    const setTargetResult = await page1.evaluate(
      (targetId) => window.electronAPI.testSetDragTarget(targetId),
      window2Id,
    );
    expect(setTargetResult).toBe(window2Id);

    // 3. End drag as cross-window (completed=true)
    await page1.evaluate(() => {
      window.electronAPI.tabDragEnd(true);
    });

    // Wait for state sync
    await page1.waitForTimeout(500);

    // Window 1 should have 5 tabs (lost one)
    await expect(page1.locator("[data-testid='tab']")).toHaveCount(5);

    // Window 2 should now have 7 tabs (6 + the moved one)
    await expect(page2.locator("[data-testid='tab']")).toHaveCount(7);

    // The moved tab should be in window 2
    const movedTab = page2.locator(`[data-tab-id="${tabId}"]`);
    await expect(movedTab).toBeVisible();
    const movedTabTitle = await movedTab.textContent();
    expect(movedTabTitle).toBe(tabTitle);
  });

  test("source window layout updates after cross-window move", async ({
    electronApp,
    page: page1,
  }) => {
    await waitForTabs(page1, 6);

    // Verify initial state: 2 panes
    await expect(page1.locator("[data-testid='pane']")).toHaveCount(2);

    // Get the first tab from the first pane
    const firstPane = page1.locator("[data-testid='pane']").first();
    const tabId = await firstPane
      .locator("[data-testid='tab']")
      .first()
      .getAttribute("data-tab-id");
    expect(tabId).not.toBeNull();

    // Drive cross-window tear-off
    await page1.evaluate((id) => {
      window.electronAPI.tabDragBegin({
        windowId: 1,
        tabId: id,
        tabTitle: "test",
        tabColour: "#fff",
        tabBounds: { x: 0, y: 0, width: 100, height: 30 },
      });
    }, tabId);

    await page1.evaluate(() => {
      window.electronAPI.tabDragEnd(true);
    });

    await electronApp.waitForEvent("window", { timeout: 15_000 });
    await page1.waitForTimeout(500);

    // Source window should still have 2 panes (lost 1 tab from first pane, not all)
    await expect(page1.locator("[data-testid='pane']")).toHaveCount(2);

    // First pane should now have 2 tabs (was 3, lost 1)
    await expect(
      firstPane.locator("[data-testid='tab']"),
    ).toHaveCount(2);
  });

  test("drag cancelled (completed=false) does not move tab", async ({
    electronApp,
    page: page1,
  }) => {
    await waitForTabs(page1, 6);

    // Begin drag
    const tabId = await page1
      .locator("[data-testid='tab']")
      .first()
      .getAttribute("data-tab-id");
    expect(tabId).not.toBeNull();

    await page1.evaluate((id) => {
      window.electronAPI.tabDragBegin({
        windowId: 1,
        tabId: id,
        tabTitle: "test",
        tabColour: "#fff",
        tabBounds: { x: 0, y: 0, width: 100, height: 30 },
      });
    }, tabId);

    // End drag as NOT completed (intra-window drop happened or cancelled)
    await page1.evaluate(() => {
      window.electronAPI.tabDragEnd(false);
    });

    await page1.waitForTimeout(500);

    // No new windows created
    expect(electronApp.windows().length).toBe(1);

    // Tab count unchanged
    await expect(page1.locator("[data-testid='tab']")).toHaveCount(6);
  });

  test("tear-off of the last tab in a pane collapses the layout", async ({
    electronApp,
    page: page1,
  }) => {
    await waitForTabs(page1, 6);

    // The first pane has 3 tabs. Tear off all of them.
    const firstPane = page1.locator("[data-testid='pane']").first();
    for (let i = 0; i < 3; i++) {
      const tabId = await firstPane
        .locator("[data-testid='tab']")
        .first()
        .getAttribute("data-tab-id");
      expect(tabId).not.toBeNull();

      await page1.evaluate((id) => {
        window.electronAPI.tabDragBegin({
          windowId: 1,
          tabId: id,
          tabTitle: "test",
          tabColour: "#fff",
          tabBounds: { x: 0, y: 0, width: 100, height: 30 },
        });
      }, tabId!);

      await page1.evaluate(() => {
        window.electronAPI.tabDragEnd(true);
      });

      await electronApp.waitForEvent("window", { timeout: 15_000 });
      await page1.waitForTimeout(300);
    }

    // Source window should collapse to a single pane
    await expect(page1.locator("[data-testid='pane']")).toHaveCount(1);
    // That pane has the remaining 3 tabs
    await expect(
      page1.locator("[data-testid='pane']").locator("[data-testid='tab']"),
    ).toHaveCount(3);

    // 3 new windows + original = 4 total
    expect(electronApp.windows().length).toBe(4);
  });
});
