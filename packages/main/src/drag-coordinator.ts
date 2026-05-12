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

export interface DragResult {
  tabId: string;
  sourceWindowId: number;
  targetWindowId: number | undefined;
  cursorPosition: { x: number; y: number };
}

export type DragCompletionHandler = (result: DragResult) => void;

interface ActiveDrag {
  sourceWindowId: number;
  tabId: string;
  /** Window currently under the cursor (updated by polling). */
  hoveredWindowId: number | undefined;
  pollInterval: ReturnType<typeof setInterval>;
  onComplete: DragCompletionHandler;
}

let activeDrag: ActiveDrag | undefined;

/**
 * Expose the current drag target for testing.
 * Only use this in tests to override the cursor-polling result.
 * Stops the polling interval so it doesn't overwrite the test value.
 */
export function setDragTargetForTest(windowId: number | undefined): void {
  if (activeDrag !== undefined) {
    clearInterval(activeDrag.pollInterval);
    activeDrag.hoveredWindowId = windowId;
  }
}

/**
 * Get the current drag target for test verification.
 */
export function getDragTargetForTest(): number | undefined {
  return activeDrag?.hoveredWindowId;
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
    hoveredWindowId: undefined,
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

  // Cross-window drag — determine target window.
  // Use the polled hoveredWindowId as a fast path, but also
  // do a final hit-test with the current cursor position in case
  // the polling interval missed a quick move.
  const cursor = screen.getCursorScreenPoint();
  let targetId = activeDrag.hoveredWindowId;

  if (targetId === undefined) {
    // Polling didn't detect a target — do a one-shot check now
    targetId = findWindowAtPoint(cursor, activeDrag.sourceWindowId);
  }

  const result: DragResult = {
    tabId: activeDrag.tabId,
    sourceWindowId: activeDrag.sourceWindowId,
    targetWindowId: targetId,
    cursorPosition: cursor,
  };

  const handler = activeDrag.onComplete;
  teardown();

  // Notify all windows that the drag ended
  broadcastDragLeave();

  handler(result);
}

function cancelDrag(): void {
  teardown();
  broadcastDragLeave();
}

function teardown(): void {
  if (activeDrag === undefined) return;
  clearInterval(activeDrag.pollInterval);
  activeDrag = undefined;
}

function broadcastDragLeave(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("drag-leave");
    }
  }
}

/**
 * Find which non-source window contains the given screen point.
 */
function findWindowAtPoint(
  point: { x: number; y: number },
  sourceWindowId: number,
): number | undefined {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (win.id === sourceWindowId) continue;

    const bounds = win.getBounds();
    if (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    ) {
      return win.id;
    }
  }
  return undefined;
}

/**
 * Poll cursor and detect which non-source window the cursor is over.
 */
function tick(): void {
  if (activeDrag === undefined) return;

  const cursor = screen.getCursorScreenPoint();
  const newHoveredId = findWindowAtPoint(cursor, activeDrag.sourceWindowId);

  if (newHoveredId !== activeDrag.hoveredWindowId) {
    // Leave old target
    if (activeDrag.hoveredWindowId !== undefined) {
      const oldWin = BrowserWindow.fromId(activeDrag.hoveredWindowId);
      if (oldWin !== null && !oldWin.isDestroyed()) {
        oldWin.webContents.send("drag-leave");
      }
    }

    // Enter new target
    if (newHoveredId !== undefined) {
      const newWin = BrowserWindow.fromId(newHoveredId);
      if (newWin !== null && !newWin.isDestroyed()) {
        newWin.webContents.send("drag-enter", { tabId: activeDrag.tabId });
      }
    }

    activeDrag.hoveredWindowId = newHoveredId;
  }
}
