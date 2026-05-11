/**
 * Shared types for tab state, layout, and IPC protocol.
 * Used by both main process and renderer.
 */

// ─── Tab model ───────────────────────────────────────────

export interface Tab {
  id: string;
  title: string;
  colour: string;
}

// ─── Layout tree (within a single window) ─────────────────

export type LayoutNode = PaneNode | SplitNode;

export interface PaneNode {
  type: "pane";
  tabIds: string[];
  activeTabId: string;
}

export interface SplitNode {
  type: "split";
  direction: "row" | "column";
  children: LayoutNode[];
  sizes: number[];
}

// ─── Window state ─────────────────────────────────────────

export interface WindowState {
  windowId: number;
  layout: LayoutNode;
  tabs: Record<string, Tab>;
}

// ─── Full app state (main process only) ───────────────────

export interface AppState {
  /** Every tab that exists, regardless of which window holds it. */
  allTabs: Record<string, Tab>;
  /** Per-window state, keyed by Electron window ID. */
  windows: Record<number, WindowState>;
}

// ─── IPC channels ─────────────────────────────────────────

export const IPC = {
  // Renderer → Main
  GET_INITIAL_STATE: "get-initial-state",
  TAB_MOVED_INTRA: "tab-moved-intra",
  DRAG_TAB_START: "drag-tab-start",
  DRAG_TAB_END: "drag-tab-end",
  REQUEST_NEW_WINDOW: "request-new-window",

  // Main → Renderer
  STATE_UPDATED: "state-updated",
  DRAG_ENTER: "drag-enter",
  DRAG_LEAVE: "drag-leave",
  DRAG_DROP_TARGET: "drag-drop-target",
} as const;

// ─── IPC payload types ────────────────────────────────────

export interface TabMovedIntraPayload {
  windowId: number;
  layout: LayoutNode;
}

export interface DragTabStartPayload {
  windowId: number;
  tabId: string;
  tabTitle: string;
  tabColour: string;
  tabBounds: { x: number; y: number; width: number; height: number };
}

export interface RequestNewWindowPayload {
  tabId: number;
  fromWindowId: number;
}

export interface DragDropTargetPayload {
  targetWindowId: number;
  tabId: string;
  insertBeforeTabId: string | undefined;
}
