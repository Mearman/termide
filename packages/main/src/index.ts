/**
 * Main process entry point. Orchestrates window creation, state, and drag coordination.
 */
import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMainWindow, createWindowWithTab } from "./window-manager.ts";
import { appState, updateWindowLayout, moveTabCrossWindow, registerWindow } from "./state.ts";
import { startDrag, endDrag, setDragTargetForTest, getDragTargetForTest } from "./drag-coordinator.ts";
import type { TabMovedIntraPayload, DragTabStartPayload } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPackage = path.resolve(__dirname, "..");

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

ipcMain.on("tab-drag-begin", (_event, payload: DragTabStartPayload): void => {
  startDrag(payload, handleDragComplete);
});

ipcMain.on("tab-drag-end", (_event, completed: boolean): void => {
  endDrag(completed);
});

// ─── Drag completion (cross-window) ───────────────────────

function handleDragComplete(result: {
  tabId: string;
  sourceWindowId: number;
  targetWindowId: number | undefined;
  cursorPosition: { x: number; y: number };
}): void {
  if (result.targetWindowId !== undefined) {
    const affected = moveTabCrossWindow(
      result.tabId,
      result.sourceWindowId,
      result.targetWindowId,
      {},
    );
    pushStateToWindows(affected.affectedWindows);
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
  }
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
    webPreferences: {
      preload: preloadPathForTest(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: "Tab Drag Prototype — Test Window",
  });

  // Register with a fresh copy of the initial demo state
  registerWindow(win.id);

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

// ─── App lifecycle ────────────────────────────────────────

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
