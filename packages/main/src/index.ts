/**
 * Main process entry point. Orchestrates window creation, state, and drag coordination.
 */
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { createMainWindow, createWindowWithTab } from "./window-manager.ts";
import { appState, updateWindowLayout, moveTabCrossWindow } from "./state.ts";
import { startDrag, endDrag } from "./drag-coordinator.ts";
import type { TabMovedIntraPayload, DragTabStartPayload } from "./types.ts";

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
