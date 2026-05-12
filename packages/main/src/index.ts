/**
 * Main process entry point. Orchestrates window creation, state, and drag coordination.
 */
import { app, BrowserWindow, ipcMain, screen } from "electron";

// Enable headless mode when launched with --headless flag (for E2E tests)
if (process.argv.includes("--headless=new") || process.argv.includes("--headless")) {
  app.commandLine.appendSwitch("headless", "new");
}
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMainWindow, createWindowWithTab } from "./window-manager.ts";
import { appState, updateWindowLayout, moveTabCrossWindow, registerWindow, toggleTabPin, openTabInWindow, pushStateToWindow } from "./state.ts";
import { startDrag, endDrag, setDragTargetForTest, getDragTargetForTest, reportDragTargetEnter, reportDragTargetLeave, setTargetPaneId, cleanupDragCoordinator } from "./drag-coordinator.ts";
import type { TabMovedIntraPayload, DragTabStartPayload } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPackage = path.resolve(__dirname, "..");
const CROSS_WINDOW_SPLIT_EDGE_RATIO = 0.25;

type CrossWindowDropResolution =
  | { kind: "insert"; paneId: string }
  | { kind: "split"; paneId: string; direction: "row" | "column"; side: "before" | "after" };

function preloadPathForTest(): string {
  return path.join(mainPackage, "dist", "preload.iife.js");
}

// ─── IPC handlers ─────────────────────────────────────────

ipcMain.on("get-window-id", (event): void => {
  const win = BrowserWindow.fromWebContents(event.sender);
  event.returnValue = win?.id ?? -1;
});

ipcMain.on("get-initial-state", (event): void => {
  const win = BrowserWindow.fromWebContents(event.sender);
  event.returnValue = win !== null && win !== undefined ? appState.windows[win.id] : undefined;
});

ipcMain.on("tab-moved-intra", (_event, payload: TabMovedIntraPayload): void => {
  updateWindowLayout(payload.windowId, payload.layout);
});

ipcMain.on("toggle-tab-pin", (event, tabId: string): void => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win === null) return;
  toggleTabPin(win.id, tabId);
});

ipcMain.on("open-tab", (event, title: string): void => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win === null) return;
  openTabInWindow(win.id, title);
});

ipcMain.on("toggle-tab-dirty", (event, tabId: string): void => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win === null) return;
  const state = appState.windows[win.id];
  if (state === undefined) return;
  const tab = state.tabs[tabId];
  if (tab === undefined) return;
  tab.dirty = !tab.dirty;
  pushStateToWindow(win.id);
});

ipcMain.on("tab-drag-begin", (_event, payload: DragTabStartPayload): void => {
  startDrag(payload, handleDragComplete);
});

ipcMain.on("tab-drag-end", (_event, completed: boolean): void => {
  endDrag(completed);
});

ipcMain.on("drag-target-enter", (_event, windowId: number): void => {
  reportDragTargetEnter(windowId);
});

ipcMain.on("drag-target-leave", (_event, windowId: number): void => {
  reportDragTargetLeave(windowId);
});

ipcMain.on("drag-target-pane", (event, data: { paneId: string }): void => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win === null) return;
  setTargetPaneId(win.id, data.paneId);
});

// ─── Drag completion (cross-window) ───────────────────────

async function handleDragComplete(result: {
  tabId: string;
  sourceWindowId: number;
  targetWindowId: number | undefined;
  targetPaneId: string | undefined;
  cursorPosition: { x: number; y: number };
}): Promise<void> {
  if (result.targetWindowId !== undefined) {
    const dropResolution = await resolveCrossWindowDrop(result.targetWindowId, result.cursorPosition);
    const affected = moveTabCrossWindow(
      result.tabId,
      result.sourceWindowId,
      result.targetWindowId,
      {
        targetPaneId: dropResolution?.paneId ?? result.targetPaneId,
        splitTarget: dropResolution?.kind === "split"
          ? {
              paneId: dropResolution.paneId,
              direction: dropResolution.direction,
              side: dropResolution.side,
            }
          : undefined,
      },
    );
    pushStateToWindows(affected.affectedWindows);
    closeWindowIfEmpty(result.sourceWindowId);
  } else {
    const newWin = createWindowWithTab(
      result.tabId,
      result.sourceWindowId,
      result.cursorPosition,
    );
    if (newWin !== undefined) {
      pushStateToWindows([result.sourceWindowId, newWin.id]);
    } else {
      pushStateToWindows([result.sourceWindowId]);
    }
    closeWindowIfEmpty(result.sourceWindowId);
  }
}

async function resolveCrossWindowDrop(
  windowId: number,
  cursorPosition: { x: number; y: number },
): Promise<CrossWindowDropResolution | undefined> {
  const win = BrowserWindow.fromId(windowId);
  if (win === null || win.isDestroyed()) return undefined;

  const bounds = win.getContentBounds();
  const clientX = cursorPosition.x - bounds.x;
  const clientY = cursorPosition.y - bounds.y;
  if (clientX < 0 || clientY < 0 || clientX > bounds.width || clientY > bounds.height) {
    return undefined;
  }

  const script = `(() => {
    const element = document.elementFromPoint(${JSON.stringify(clientX)}, ${JSON.stringify(clientY)});
    if (!(element instanceof HTMLElement)) return undefined;
    const pane = element.closest(".pane");
    if (!(pane instanceof HTMLElement)) return undefined;
    const paneId = pane.dataset.paneId;
    if (paneId === undefined || paneId.length === 0) return undefined;

    const content = element.closest(".pane-content");
    if (content instanceof HTMLElement && pane.contains(content)) {
      const rect = content.getBoundingClientRect();
      const rx = (${JSON.stringify(clientX)} - rect.left) / rect.width;
      const ry = (${JSON.stringify(clientY)} - rect.top) / rect.height;
      const distances = [
        { zone: "left", distance: rx },
        { zone: "right", distance: 1 - rx },
        { zone: "top", distance: ry },
        { zone: "bottom", distance: 1 - ry },
      ];
      const closest = distances.reduce((a, b) => a.distance < b.distance ? a : b);
      if (closest.distance < ${CROSS_WINDOW_SPLIT_EDGE_RATIO}) {
        if (closest.zone === "left") return { kind: "split", paneId, direction: "row", side: "before" };
        if (closest.zone === "right") return { kind: "split", paneId, direction: "row", side: "after" };
        if (closest.zone === "top") return { kind: "split", paneId, direction: "column", side: "before" };
        return { kind: "split", paneId, direction: "column", side: "after" };
      }
    }

    return { kind: "insert", paneId };
  })()`;

  try {
    const value: unknown = await win.webContents.executeJavaScript(script, true);
    return isCrossWindowDropResolution(value) ? value : undefined;
  } catch (error) {
    console.error("Failed to resolve cross-window drop", error);
    return undefined;
  }
}

function isCrossWindowDropResolution(value: unknown): value is CrossWindowDropResolution {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value) || !("paneId" in value)) return false;
  if (typeof value.paneId !== "string" || value.paneId.length === 0) return false;
  if (value.kind === "insert") return true;
  if (value.kind !== "split") return false;
  if (!("direction" in value) || !("side" in value)) return false;
  return (
    (value.direction === "row" || value.direction === "column") &&
    (value.side === "before" || value.side === "after")
  );
}

function closeWindowIfEmpty(windowId: number): void {
  const state = appState.windows[windowId];
  if (state === undefined) return;
  const tabIds = collectAllTabIds(state.layout);
  if (tabIds.length === 0) {
    const win = BrowserWindow.fromId(windowId);
    delete appState.windows[windowId];
    if (win !== null && !win.isDestroyed()) {
      win.destroy();
    }
  }
}

function collectAllTabIds(node: import("./types.ts").LayoutNode): string[] {
  if (node.type === "pane") return [...node.tabIds];
  return node.children.flatMap(collectAllTabIds);
}

// ─── Helpers ──────────────────────────────────────────────

function pushStateToWindows(windowIds: number[]): void {
  for (const wid of windowIds) {
    const win = BrowserWindow.fromId(wid);
    const state = appState.windows[wid];
    if (win !== null && !win.isDestroyed() && state !== undefined) {
      win.webContents.send("state-updated", state);
    }
  }
}

// ─── Test-only IPC handlers ───────────────────────────────
// These exist solely for E2E tests to control cross-window behaviour
// without relying on OS-level cursor movement (which doesn't work headlessly).

ipcMain.handle("test-create-window", async (_event): Promise<number> => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      preload: preloadPathForTest(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: "Tab Drag Prototype — Test Window",
  });

  // Register with a fresh copy of the initial demo state
  registerWindow(win.id, { splitLayout: true });

  const RENDERER_URL = process.env.RENDERER_URL ?? "http://localhost:5173";
  if (!RENDERER_URL.startsWith("file://")) {
    win.loadURL(RENDERER_URL);
  } else {
    win.loadFile(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "renderer",
        "dist",
        "index.html",
      ),
    );
  }

  return win.id;
});

/** Override the drag coordinator's hovered window for testing. Returns the value set. */
ipcMain.on("test-set-drag-target", (event, windowId: number | undefined): void => {
  setDragTargetForTest(windowId);
  // Return the actual hoveredWindowId for verification
  const actual = getDragTargetForTest();
  event.returnValue = actual;
});

/** Move a window to specific screen coordinates for headed tests. */
ipcMain.on("test-position-window", (
  event,
  opts: { windowId: number; x: number; y: number; width: number; height: number },
): void => {
  const win = BrowserWindow.fromId(opts.windowId);
  if (win !== null && !win.isDestroyed()) {
    win.setBounds({ x: opts.x, y: opts.y, width: opts.width, height: opts.height });
  }
  event.returnValue = true;
});

/** Convert a window's layout to a split (for tests needing 2-pane setup). */
ipcMain.on("test-set-split-layout", (event, windowId: number): void => {
  const ws = appState.windows[windowId];
  if (ws === undefined) { event.returnValue = false; return; }
  const tabIds = ws.layout.type === "pane" ? ws.layout.tabIds : [];
  if (tabIds.length < 2) { event.returnValue = false; return; }
  const mid = Math.ceil(tabIds.length / 2);
  ws.layout = {
    type: "split",
    direction: "row",
    sizes: [50, 50],
    children: [
      { type: "pane", tabIds: tabIds.slice(0, mid), pinnedTabIds: [], activeTabId: tabIds[0]! },
      { type: "pane", tabIds: tabIds.slice(mid), pinnedTabIds: [], activeTabId: tabIds[mid]! },
    ],
  };
  pushStateToWindow(windowId);
  event.returnValue = true;
});

// ─── App lifecycle ────────────────────────────────────────

app.on("before-quit", (): void => {
  cleanupDragCoordinator();
});

app.on("will-quit", (): void => {
  cleanupDragCoordinator();
});

app.on("window-all-closed", (): void => {
  app.quit();
});

app.on("ready", (): void => {
  createMainWindow();
});

app.on("activate", (): void => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
