import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixture";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(__dirname, "__screenshots__");

test.describe("Tab Drag Prototype", () => {
  test("launches and shows the main window", async ({ electronApp, page }) => {
    const isPackaged = await electronApp.evaluate(async ({ app }) => {
      return app.isPackaged;
    });
    expect(isPackaged).toBe(false);

    const title = await page.title();
    expect(title).toBe("Tab Drag Prototype");

    const windows = electronApp.windows();
    expect(windows).toHaveLength(1);
  });

  test("window.electronAPI is available via preload", async ({ page }) => {
    const hasAPI = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).electronAPI !== "undefined";
    });
    expect(hasAPI).toBe(true);
  });

  test("IPC: get-window-id returns a positive integer", async ({ page }) => {
    const windowId = await page.evaluate(() => {
      const api = (window as unknown as { electronAPI: { getWindowId(): number } }).electronAPI;
      return api.getWindowId();
    });
    expect(typeof windowId).toBe("number");
    expect(windowId).toBeGreaterThan(0);
  });

  test("IPC: get-initial-state returns window state with layout and tabs", async ({ page }) => {
    const state = await page.evaluate(() => {
      const api = (window as unknown as {
        electronAPI: { getInitialState(): unknown };
      }).electronAPI;
      return api.getInitialState();
    });

    expect(state).toBeDefined();
    const s = state as Record<string, unknown>;
    expect(s).toHaveProperty("layout");
    expect(s).toHaveProperty("tabs");
    expect(s).toHaveProperty("windowId");

    const layout = s.layout as Record<string, unknown>;
    expect(layout.type).toBe("split");
    expect(layout.direction).toBe("row");
  });

  test("renders mosaic with tab groups in split layout", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");

    // Mosaic renders .mosaic-tile for each visible tile
    const tiles = page.locator(".mosaic-tile");
    await expect(tiles).toHaveCount(2, { timeout: 10_000 });

    // Tab buttons are rendered by mosaic's tab bar
    const tabButtons = page.locator(".mosaic-tab-button");
    await expect(tabButtons).toHaveCount(6, { timeout: 10_000 });
  });

  test("split layout has a mosaic-split divider", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");

    const splits = page.locator(".mosaic-split");
    await expect(splits).toHaveCount(1, { timeout: 10_000 });
  });

  test("takes a screenshot of the initial state", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(".mosaic-tile").first().waitFor({ timeout: 10_000 });

    const fs = await import("node:fs/promises");
    await fs.mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: path.join(screenshotDir, "initial-state.png"),
    });
  });
});
