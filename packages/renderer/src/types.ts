/**
 * Type declarations for the Electron preload bridge.
 */
export interface ElectronAPI {
  getWindowId: () => number;
  getInitialState: () => WindowStateFromMain | undefined;
  onStateUpdated: (callback: (state: WindowStateFromMain) => void) => () => void;
  onDragEnter: (callback: (data: { tabId: string }) => void) => () => void;
  onDragLeave: (callback: () => void) => () => void;
  tabMovedIntra: (data: { windowId: number; layout: LayoutNode }) => void;
  toggleTabPin: (tabId: string) => void;
  /** Open a tab by title (preview model: replaces current preview, pins if already open). */
  openTab: (title: string) => Promise<void>;
  /** Toggle the dirty/modified state of a tab. */
  toggleTabDirty: (tabId: string) => Promise<void>;
  tabDragBegin: (data: {
    windowId: number;
    tabId: string;
    tabTitle: string;
    tabColour: string;
    tabBounds: { x: number; y: number; width: number; height: number };
  }) => void;
  tabDragEnd: (completed: boolean) => void;
  dragTargetEnter: (windowId: number) => void;
  dragTargetLeave: (windowId: number) => void;

  // Test-only APIs
  testCreateWindow: () => Promise<number>;
  testSetDragTarget: (windowId: number | undefined) => number | undefined;
  testPositionWindow: (opts: { windowId: number; x: number; y: number; width: number; height: number }) => boolean;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export interface Tab {
  id: string;
  title: string;
  colour: string;
  pinned: boolean;
  /** Preview tabs are italic and replaced on next open. */
  preview: boolean;
  /** Tab has unsaved changes (dirty indicator). */
  dirty: boolean;
}

export interface PaneNode {
  type: "pane";
  tabIds: string[];
  /** Tab IDs that are pinned. Always a subset of tabIds. Rendered first. */
  pinnedTabIds: string[];
  activeTabId: string;
}

export interface SplitNode {
  type: "split";
  direction: "row" | "column";
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode = PaneNode | SplitNode;

export interface WindowStateFromMain {
  windowId: number;
  layout: LayoutNode;
  tabs: Record<string, Tab>;
}

export {};
