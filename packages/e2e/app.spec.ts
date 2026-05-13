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
      return (
        typeof (window as unknown as Record<string, unknown>).electronAPI !==
        "undefined"
      );
    });
    expect(hasAPI).toBe(true);
  });

  test("IPC: get-window-id returns a positive integer", async ({ page }) => {
    const windowId = await page.evaluate(() => {
      const api = (
        window as unknown as { electronAPI: { getWindowId(): number } }
      ).electronAPI;
      return api.getWindowId();
    });
    expect(typeof windowId).toBe("number");
    expect(windowId).toBeGreaterThan(0);
  });

  test("IPC: get-initial-state returns window state with layout and tabs", async ({
    page,
  }) => {
    const state = await page.evaluate(() => {
      const api = (
        window as unknown as {
          electronAPI: { getInitialState(): unknown };
        }
      ).electronAPI;
      return api.getInitialState();
    });

    expect(state).toBeDefined();
    const s = state as Record<string, unknown>;
    expect(s).toHaveProperty("layout");
    expect(s).toHaveProperty("tabs");
    expect(s).toHaveProperty("windowId");

    const layout = s.layout as Record<string, unknown>;
    expect(layout.type).toBe("pane");
  });

  test("renders tab groups in split layout", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");

    // Single pane with 6 tabs
    const panes = page.locator(".pane");
    await expect(panes).toHaveCount(1, { timeout: 10_000 });

    const tabButtons = page.locator(".tab-button");
    await expect(tabButtons).toHaveCount(6, { timeout: 10_000 });
  });

  test("no resize divider in single-pane layout", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");

    const splits = page.locator(".resize-handle");
    await expect(splits).toHaveCount(0, { timeout: 10_000 });
  });

  test("takes a screenshot of the initial state", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    await page.locator(".pane").first().waitFor({ timeout: 10_000 });

    const fs = await import("node:fs/promises");
    await fs.mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: path.join(screenshotDir, "initial-state.png"),
    });
  });
});
