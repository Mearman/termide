/**
 * Cross-window tab drag coordination.
 *
 * Tracks the global cursor during an active tab drag and identifies
 * which (if any) other window the cursor is over. Returns results
 * to the caller — does not create windows or push state itself.
 */
import { screen, BrowserWindow } from "electron";
import type { DragTabStartPayload } from "./types";

interface ActiveDrag {
  sourceWindowId: number;
  tabId: string;
  currentTargetWindowId: number | undefined;
  interval: ReturnType<typeof setInterval>;
}

let activeDrag: ActiveDrag | undefined;

export function startDrag(payload: DragTabStartPayload): void {
  if (activeDrag !== undefined) {
    endDrag(false);
  }

  const interval = setInterval(tick, 16); // ~60fps
  activeDrag = {
    sourceWindowId: payload.windowId,
    tabId: payload.tabId,
    currentTargetWindowId: undefined,
    interval,
  };
}

export interface DragResult {
  /** The tab that was being dragged. */
  tabId: string;
  /** The window the drag started from. */
  sourceWindowId: number;
  /** The window the tab was dropped on, if any. */
  targetWindowId: number | undefined;
}

export function endDrag(completed: boolean): DragResult | undefined {
  if (activeDrag === undefined) return undefined;

  clearInterval(activeDrag.interval);

  const result: DragResult = {
    tabId: activeDrag.tabId,
    sourceWindowId: activeDrag.sourceWindowId,
    targetWindowId: activeDrag.currentTargetWindowId,
  };

  // Clear visual state on all windows
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("drag-leave");
    }
  }

  activeDrag = undefined;

  return completed ? result : undefined;
}

function tick(): void {
  if (activeDrag === undefined) return;

  const cursor = screen.getCursorScreenPoint();
  const windows = BrowserWindow.getAllWindows();

  let foundTarget: BrowserWindow | undefined;
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
      foundTarget = win;
      break;
    }
  }

  const newTargetId = foundTarget?.id;

  if (newTargetId !== activeDrag.currentTargetWindowId) {
    // Leave old target
    if (activeDrag.currentTargetWindowId !== undefined) {
      const oldWin = BrowserWindow.fromId(activeDrag.currentTargetWindowId);
      oldWin?.webContents.send("drag-leave");
    }

    // Enter new target
    if (newTargetId !== undefined) {
      foundTarget?.webContents.send("drag-enter", { tabId: activeDrag.tabId });
    }

    activeDrag.currentTargetWindowId = newTargetId;
  }
}
