/**
 * Cross-window tab drag coordination.
 *
 * When the renderer starts a tab drag (HTML5 DnD), it notifies the main process
 * via tab-drag-begin. The main process starts polling the cursor position.
 *
 * If the drag stays within the same window, HTML5 DnD handles it — the renderer
 * calls tab-drag-end with completed=false and nothing happens.
 *
 * If the drag leaves the window (dragend fires with dropEffect "none"),
 * the renderer calls tab-drag-end with completed=true. The main process checks
 * where the cursor is and either moves the tab to another window or creates a
 * new one.
 */
import { screen, BrowserWindow } from "electron";
import type { DragTabStartPayload } from "./types.ts";

interface ActiveDrag {
  sourceWindowId: number;
  tabId: string;
  targetWindowId: number | undefined;
  pollInterval: ReturnType<typeof setInterval>;
}

let activeDrag: ActiveDrag | undefined;

export type DragCompletionHandler = (result: DragResult) => void;

export interface DragResult {
  tabId: string;
  sourceWindowId: number;
  targetWindowId: number | undefined;
  cursorPosition: { x: number; y: number };
}

/**
 * Begin tracking cursor for a potential cross-window drag.
 */
export function startDrag(
  payload: DragTabStartPayload,
  onComplete: DragCompletionHandler,
): void {
  if (activeDrag !== undefined) {
    cancelDrag();
  }

  const pollInterval = setInterval(() => tick(), 16);
  activeDrag = {
    sourceWindowId: payload.windowId,
    tabId: payload.tabId,
    targetWindowId: undefined,
    pollInterval,
    onComplete,
  };
}

/**
 * Renderer reports the drag ended.
 * If completed=true, the drag left the window — handle cross-window drop.
 */
export function endDrag(completed: boolean): void {
  if (activeDrag === undefined) return;

  if (!completed) {
    // Intra-window drag — just clean up
    teardown();
    return;
  }

  // Cross-window drag — figure out where the cursor is
  const cursor = screen.getCursorScreenPoint();
  const result: DragResult = {
    tabId: activeDrag.tabId,
    sourceWindowId: activeDrag.sourceWindowId,
    targetWindowId: activeDrag.currentTargetWindowId,
    cursorPosition: cursor,
  };

  const handler = activeDrag.onComplete;
  teardown();

  // Notify all windows that the drag ended
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("drag-leave");
    }
  }

  handler(result);
}

function cancelDrag(): void {
  teardown();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("drag-leave");
    }
  }
}

function teardown(): void {
  if (activeDrag === undefined) return;
  clearInterval(activeDrag.pollInterval);
  activeDrag = undefined;
}

/**
 * Poll cursor and detect which non-source window the cursor is over.
 */
function tick(): void {
  if (activeDrag === undefined) return;

  const cursor = screen.getCursorScreenPoint();
  const windows = BrowserWindow.getAllWindows();

  let newTargetId: number | undefined;
  for (const win of windows) {
    if (win.isDestroyed()) continue;
    if (win.id === activeDrag.sourceWindowId) continue;

    const bounds = win.getBounds();
    if (
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + bounds.height
    ) {
      newTargetId = win.id;
      break;
    }
  }

  if (newTargetId !== activeDrag.currentTargetWindowId) {
    // Leave old target
    if (activeDrag.currentTargetWindowId !== undefined) {
      const oldWin = BrowserWindow.fromId(activeDrag.currentTargetWindowId);
      if (oldWin !== null && !oldWin.isDestroyed()) {
        oldWin.webContents.send("drag-leave");
      }
    }

    // Enter new target
    if (newTargetId !== undefined) {
      const newWin = BrowserWindow.fromId(newTargetId);
      if (newWin !== null && !newWin.isDestroyed()) {
        newWin.webContents.send("drag-enter", { tabId: activeDrag.tabId });
      }
    }

    activeDrag.currentTargetWindowId = newTargetId;
  }
}
