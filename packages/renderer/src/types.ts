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
  dragTabStart: (data: {
    windowId: number;
    tabId: string;
    tabBounds: { x: number; y: number; width: number; height: number };
  }) => void;
  dragTabEnd: (completed: boolean) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Re-export the shared types from main (in a real app these would be a shared package)
export interface Tab {
  id: string;
  title: string;
  colour: string;
}

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

export type LayoutNode = PaneNode | SplitNode;

export interface WindowStateFromMain {
  windowId: number;
  layout: LayoutNode;
  tabs: Record<string, Tab>;
}

export {};
