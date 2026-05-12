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
  /** Semi-transparent ghost window following the cursor during drag. */
  ghostWindow: BrowserWindow | undefined;
  /** Whether the cursor has left the source window (ghost should be visible). */
  cursorOutsideSource: boolean;
  /** Payload data for lazy ghost window creation. */
  ghostPayload: DragTabStartPayload;
  /** Tick count since cursor left source window — used to debounce ghost creation. */
  ticksOutsideSource: number;
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
  // Don't let the poll interval prevent process exit
  pollInterval.unref();

  activeDrag = {
    sourceWindowId: payload.windowId,
    tabId: payload.tabId,
    hoveredWindowId: undefined,
    targetExplicit: false,
    pollInterval,
    onComplete,
    ghostWindow: undefined,
    cursorOutsideSource: false,
    ghostPayload: payload,
    ticksOutsideSource: 0,
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

/**
 * Force cleanup of any active drag state (for app shutdown).
 */
export function cleanupDragCoordinator(): void {
  if (activeDrag !== undefined) {
    cancelDrag();
  }
}

function teardown(): void {
  if (activeDrag === undefined) return;
  clearInterval(activeDrag.pollInterval);
  if (activeDrag.ghostWindow !== undefined && !activeDrag.ghostWindow.isDestroyed()) {
    activeDrag.ghostWindow.destroy(); // Use destroy() instead of close() for immediate cleanup
  }
  activeDrag = undefined;
}

function broadcastDragLeave(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("drag-leave");
    }
  }
}

// ─── Ghost window ────────────────────────────────────────

const GHOST_WIDTH = 300;
const GHOST_HEIGHT = 60;
const GHOST_OFFSET_X = 12;
const GHOST_OFFSET_Y = 12;
/** Number of ticks the cursor must be outside before the ghost window is created. ~80ms. */
const GHOST_DEBOUNCE_TICKS = 5;

/**
 * Position and show/hide the ghost window based on cursor position.
 * The ghost is only visible when the cursor is outside the source window.
 */
function updateGhostWindow(cursor: { x: number; y: number }): void {
  if (activeDrag === undefined) return;

  const sourceWin = BrowserWindow.fromId(activeDrag.sourceWindowId);
  const isOverSource = sourceWin !== null && !sourceWin.isDestroyed() && isPointInBounds(cursor, sourceWin.getBounds());
  const isOverTarget = activeDrag.hoveredWindowId !== undefined;

  const outsideSource = !isOverSource && !isOverTarget;

  // Track how long the cursor has been outside
  if (outsideSource) {
    activeDrag.ticksOutsideSource++;
  } else {
    activeDrag.ticksOutsideSource = 0;
  }

  // Only create/show ghost after sustained period outside
  const shouldShow = activeDrag.ticksOutsideSource >= GHOST_DEBOUNCE_TICKS;

  // Create ghost window lazily when first needed
  if (shouldShow && activeDrag.ghostWindow === undefined) {
    activeDrag.ghostWindow = new BrowserWindow({
      width: GHOST_WIDTH,
      height: GHOST_HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      focusable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    activeDrag.ghostWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildGhostHTML(activeDrag.ghostPayload))}`,
    );
  }

  const ghost = activeDrag.ghostWindow;
  if (ghost === undefined || ghost.isDestroyed()) return;

  if (shouldShow !== activeDrag.cursorOutsideSource) {
    activeDrag.cursorOutsideSource = shouldShow;
    if (shouldShow) {
      ghost.showInactive();
    } else {
      ghost.hide();
    }
  }

  if (shouldShow) {
    ghost.setPosition(
      Math.round(cursor.x + GHOST_OFFSET_X),
      Math.round(cursor.y + GHOST_OFFSET_Y),
    );
  }
}

function isPointInBounds(point: { x: number; y: number }, bounds: Electron.Rectangle): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function buildGhostHTML(payload: DragTabStartPayload): string {
  const escapedTitle = payload.tabTitle
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: rgba(30, 30, 30, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    height: ${GHOST_HEIGHT}px;
    color: #e0e0e0;
    font-size: 13px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
</head>
<body>
  <div class="tab">
    <div class="dot" style="background-color: ${payload.tabColour}"></div>
    <span class="title">${escapedTitle}</span>
  </div>
</body>
</html>`;
}

// ─── Cursor polling fallback ──────────────────────────────

/**
 * Poll cursor and detect which non-source window the cursor is over.
 * Only updates if no broadcast target has been set (targetExplicit=false).
 */
function tick(): void {
  if (activeDrag === undefined) return;

  const cursor = screen.getCursorScreenPoint();

  // Update ghost window position and visibility
  updateGhostWindow(cursor);

  if (activeDrag.targetExplicit) return; // broadcast/test has priority

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
  const ghostId = activeDrag?.ghostWindow?.id;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (win.id === sourceWindowId) continue;
    if (ghostId !== undefined && win.id === ghostId) continue;

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
