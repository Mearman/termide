/**
 * Cross-window tab drag coordination.
 *
 * Uses a hybrid approach:
 * 1. Primary: BroadcastChannel from renderers reports drag-over state
 *    (each window fires dragover/dragleave DOM events which propagate
 *    via IPC to the main process)
 * 2. Fallback: Cursor polling via screen.getCursorScreenPoint() when
 *    no broadcast has been received
 * 3. Final hit-test: On endDrag, if no target was detected, does a
 *    one-shot cursor position check
 *
 * For tests: setDragTargetForTest() overrides the target directly.
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
  /** Window currently reported as drag target (from broadcast or polling). */
  hoveredWindowId: number | undefined;
  /** Whether the target was set explicitly (broadcast or test override). */
  targetExplicit: boolean;
  pollInterval: ReturnType<typeof setInterval>;
  onComplete: DragCompletionHandler;
}

let activeDrag: ActiveDrag | undefined;

// ─── Broadcast-based target updates (from renderer IPC) ────

/**
 * A renderer reports that a drag is over its window.
 * Called via drag-target-enter IPC from the renderer's dragover handler.
 */
export function reportDragTargetEnter(windowId: number): void {
  if (activeDrag === undefined) return;
  if (windowId === activeDrag.sourceWindowId) return;

  const prevId = activeDrag.hoveredWindowId;
  activeDrag.hoveredWindowId = windowId;
  activeDrag.targetExplicit = true;

  if (prevId !== windowId) {
    // Leave old target
    if (prevId !== undefined) {
      const oldWin = BrowserWindow.fromId(prevId);
      if (oldWin !== null && !oldWin.isDestroyed()) {
        oldWin.webContents.send("drag-leave");
      }
    }
    // Enter new target
    const newWin = BrowserWindow.fromId(windowId);
    if (newWin !== null && !newWin.isDestroyed()) {
      newWin.webContents.send("drag-enter", { tabId: activeDrag.tabId });
    }
  }
}

/**
 * A renderer reports that a drag left its window.
 * Called via drag-target-leave IPC from the renderer's dragleave handler.
 */
export function reportDragTargetLeave(windowId: number): void {
  if (activeDrag === undefined) return;
  if (activeDrag.hoveredWindowId !== windowId) return;

  activeDrag.hoveredWindowId = undefined;
  activeDrag.targetExplicit = false;

  const win = BrowserWindow.fromId(windowId);
  if (win !== null && !win.isDestroyed()) {
    win.webContents.send("drag-leave");
  }
}

// ─── Test-only overrides ──────────────────────────────────

/**
 * Override the drag coordinator's hovered window for testing.
 * Stops polling so it doesn't overwrite the test value.
 */
export function setDragTargetForTest(windowId: number | undefined): void {
  if (activeDrag === undefined) return;
  clearInterval(activeDrag.pollInterval);
  activeDrag.hoveredWindowId = windowId;
  activeDrag.targetExplicit = true;
}

/**
 * Get the current drag target for test verification.
 */
export function getDragTargetForTest(): number | undefined {
  return activeDrag?.hoveredWindowId;
}

// ─── Drag lifecycle ───────────────────────────────────────

/**
 * Begin tracking for a potential cross-window drag.
 * Starts cursor polling as a fallback; broadcast updates override it.
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
    targetExplicit: false,
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
    teardown();
    return;
  }

  // Cross-window drag — determine target.
  const cursor = screen.getCursorScreenPoint();
  let targetId = activeDrag.hoveredWindowId;

  if (targetId === undefined) {
    // No broadcast or polling detected a target — one-shot check
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

// ─── Cursor polling fallback ──────────────────────────────

/**
 * Poll cursor and detect which non-source window the cursor is over.
 * Only updates if no broadcast target has been set (targetExplicit=false).
 */
function tick(): void {
  if (activeDrag === undefined) return;
  if (activeDrag.targetExplicit) return; // broadcast/test has priority

  const cursor = screen.getCursorScreenPoint();
  const newHoveredId = findWindowAtPoint(cursor, activeDrag.sourceWindowId);

  if (newHoveredId !== activeDrag.hoveredWindowId) {
    if (activeDrag.hoveredWindowId !== undefined) {
      const oldWin = BrowserWindow.fromId(activeDrag.hoveredWindowId);
      if (oldWin !== null && !oldWin.isDestroyed()) {
        oldWin.webContents.send("drag-leave");
      }
    }

    if (newHoveredId !== undefined) {
      const newWin = BrowserWindow.fromId(newHoveredId);
      if (newWin !== null && !newWin.isDestroyed()) {
        newWin.webContents.send("drag-enter", { tabId: activeDrag.tabId });
      }
    }

    activeDrag.hoveredWindowId = newHoveredId;
  }
}

// ─── Hit-testing ──────────────────────────────────────────

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
