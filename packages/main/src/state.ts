/**
 * Canonical application state. Lives in the main process.
 * Every mutation happens here; renderers receive snapshots.
 */
import { BrowserWindow } from "electron";
import type { AppState, LayoutNode, PaneNode, SplitNode, Tab } from "./types.ts";

let nextTabId = 1;
function makeTabId(): string {
  return `tab-${nextTabId++}`;
}

function makeTab(title: string, colour: string): Tab {
  return { id: makeTabId(), title, colour, pinned: false, preview: false, dirty: false };
}

function makePane(...tabIds: string[]): PaneNode {
  return {
    type: "pane",
    tabIds,
    pinnedTabIds: [],
    activeTabId: tabIds[0],
  };
}

export const appState: AppState = {
  allTabs: {},
  windows: {},
};

export function registerWindow(windowId: number, options?: { splitLayout?: boolean }): void {
  // Each window gets its own independent set of tabs with unique IDs.
  const windowTabs: Record<string, Tab> = {};
  const demoTabMeta = [
    { title: "README.md", colour: "#4a90d9" },
    { title: "index.ts", colour: "#7bc67e" },
    { title: "styles.css", colour: "#d4a05a" },
    { title: "package.json", colour: "#c75d5d" },
    { title: "config.ts", colour: "#9b6dbf" },
    { title: "utils.ts", colour: "#5db8a0" },
  ];
  const windowDemoTabs = demoTabMeta.map((m) => makeTab(m.title, m.colour));
  for (const t of windowDemoTabs) {
    windowTabs[t.id] = t;
  }

  const layout: LayoutNode = options?.splitLayout
    ? {
        type: "split",
        direction: "row",
        sizes: [50, 50],
        children: [
          makePane(windowDemoTabs[0].id, windowDemoTabs[1].id, windowDemoTabs[2].id),
          makePane(windowDemoTabs[3].id, windowDemoTabs[4].id, windowDemoTabs[5].id),
        ],
      }
    : makePane(
        windowDemoTabs[0].id,
        windowDemoTabs[1].id,
        windowDemoTabs[2].id,
        windowDemoTabs[3].id,
        windowDemoTabs[4].id,
        windowDemoTabs[5].id,
      );

  appState.windows[windowId] = {
    windowId,
    layout,
    tabs: windowTabs,
  };
}

export function getWindowState(windowId: number): AppState["windows"][number] {
  return appState.windows[windowId];
}

/**
 * Move a tab from one window to another (or to a new window).
 * Returns the updated state for affected windows.
 */
export function moveTabCrossWindow(
  tabId: string,
  fromWindowId: number,
  toWindowId: number,
  options: { insertBeforeTabId?: string; targetPaneId?: string },
): { affectedWindows: number[] } {
  const fromState = appState.windows[fromWindowId];
  const toState = appState.windows[toWindowId];
  if (fromState === undefined || toState === undefined) {
    return { affectedWindows: [fromWindowId, toWindowId] };
  }

  // Remove tab from source window
  const removedTab = fromState.tabs[tabId];
  if (removedTab === undefined) {
    return { affectedWindows: [fromWindowId] };
  }
  removeTabFromLayout(fromState.layout, tabId);
  delete fromState.tabs[tabId];

  // Add tab to target window
  toState.tabs[tabId] = removedTab;
  insertTabIntoLayout(toState.layout, tabId, options.insertBeforeTabId, options.targetPaneId);

  return { affectedWindows: [fromWindowId, toWindowId] };
}

/**
 * Create a brand-new window state with a single tab.
 */
export function createWindowForTab(
  tabId: string,
  fromWindowId: number,
  newWindowId: number,
): void {
  const fromState = appState.windows[fromWindowId];
  if (fromState === undefined) return;

  const tab = fromState.tabs[tabId];
  if (tab === undefined) return;

  removeTabFromLayout(fromState.layout, tabId);
  delete fromState.tabs[tabId];

  appState.windows[newWindowId] = {
    windowId: newWindowId,
    layout: { type: "pane", tabIds: [tabId], pinnedTabIds: [], activeTabId: tabId },
    tabs: { [tabId]: tab },
  };
}

/**
 * Update a window's layout after an intra-window tab move.
 * Also removes any tabs from the window's tabs dict that are no longer
 * referenced in the layout tree.
 */
export function updateWindowLayout(
  windowId: number,
  newLayout: LayoutNode,
): void {
  const state = appState.windows[windowId];
  if (state !== undefined) {
    state.layout = newLayout;
    // Collect tab IDs still referenced in the layout
    const referencedIds = new Set(collectTabIds(newLayout));
    // Remove tabs no longer referenced
    for (const tabId of Object.keys(state.tabs)) {
      if (!referencedIds.has(tabId)) {
        delete state.tabs[tabId];
      }
    }
  }
}

function collectTabIds(node: LayoutNode): string[] {
  if (node.type === "pane") return [...node.tabIds];
  return node.children.flatMap(collectTabIds);
}

/**
 * Toggle the pinned state of a tab in its containing pane.
 * Pinned tabs are moved to the front of the pane's tab list.
 */
export function toggleTabPin(windowId: number, tabId: string): void {
  const state = appState.windows[windowId];
  if (state === undefined) return;

  const pane = findPaneContainingTab(state.layout, tabId);
  if (pane === undefined) return;

  const tab = state.tabs[tabId];
  if (tab === undefined) return;

  tab.pinned = !tab.pinned;

  if (tab.pinned) {
    // Pinning always clears preview status
    tab.preview = false;
    // Add to pinned list if not already there
    if (!pane.pinnedTabIds.includes(tabId)) {
      pane.pinnedTabIds.push(tabId);
    }
    // Move to front of tabIds
    const idx = pane.tabIds.indexOf(tabId);
    if (idx > 0) {
      pane.tabIds.splice(idx, 1);
      pane.tabIds.unshift(tabId);
    }
    // Ensure all pinned tabs come before unpinned
    reorderPinnedFirst(pane);
  } else {
    // Remove from pinned list
    const pinnedIdx = pane.pinnedTabIds.indexOf(tabId);
    if (pinnedIdx !== -1) {
      pane.pinnedTabIds.splice(pinnedIdx, 1);
    }
    reorderPinnedFirst(pane);
  }

  pushStateToWindow(windowId);
}

function reorderPinnedFirst(pane: PaneNode): void {
  const pinned = pane.pinnedTabIds.filter((id) => pane.tabIds.includes(id));
  const unpinned = pane.tabIds.filter((id) => !pane.pinnedTabIds.includes(id));
  pane.tabIds = [...pinned, ...unpinned];
}

/**
 * Open a tab in the active pane of a window, following VSCode's preview model:
 * - If there's an existing preview tab, replace it with the new one
 * - Otherwise, add a new preview tab at the end of unpinned tabs
 * - If the title matches a pinned tab, activate it instead
 */
export function openTabInWindow(windowId: number, title: string): void {
  const state = appState.windows[windowId];
  if (state === undefined) return;

  // Find the active pane
  const activePane = findActivePane(state.layout);
  if (activePane === undefined) return;

  // Check if the tab is already open (pinned or unpinned)
  for (const tabId of activePane.tabIds) {
    const tab = state.tabs[tabId];
    if (tab !== undefined && tab.title === title) {
      // Already open — activate it and pin if preview
      if (tab.preview) {
        tab.preview = false;
        tab.pinned = true;
        if (!activePane.pinnedTabIds.includes(tabId)) {
          activePane.pinnedTabIds.push(tabId);
          reorderPinnedFirst(activePane);
        }
      }
      activePane.activeTabId = tabId;
      pushStateToWindow(windowId);
      return;
    }
  }

  // Create a new preview tab
  const colours = ["#4a90d9", "#7bc67e", "#d4a05a", "#c75d5d", "#9b6dbf", "#5db8a0"];
  const colour = colours[Math.floor(Math.random() * colours.length)];
  const newTab: Tab = {
    id: makeTabId(),
    title,
    colour,
    pinned: false,
    preview: true,
    dirty: false,
  };
  state.tabs[newTab.id] = newTab;

  // Replace existing preview tab, or append after pinned tabs
  const existingPreviewIdx = activePane.tabIds.findIndex(
    (id) => state.tabs[id]?.preview === true,
  );
  if (existingPreviewIdx !== -1) {
    const oldId = activePane.tabIds[existingPreviewIdx]!;
    delete state.tabs[oldId];
    activePane.tabIds[existingPreviewIdx] = newTab.id;
  } else {
    // Insert after pinned tabs
    const insertIdx = activePane.pinnedTabIds.length;
    activePane.tabIds.splice(insertIdx, 0, newTab.id);
  }
  activePane.activeTabId = newTab.id;

  pushStateToWindow(windowId);
}

function findActivePane(node: LayoutNode): PaneNode | undefined {
  if (node.type === "pane") return node;
  // Return the first pane that has an active tab, or the first pane
  for (const child of node.children) {
    const pane = findActivePane(child);
    if (pane !== undefined && pane.activeTabId !== "") return pane;
  }
  // Fallback: return first pane
  for (const child of node.children) {
    const pane = findActivePane(child);
    if (pane !== undefined) return pane;
  }
  return undefined;
}

function findPaneContainingTab(node: LayoutNode, tabId: string): PaneNode | undefined {
  if (node.type === "pane") {
    return node.tabIds.includes(tabId) ? node : undefined;
  }
  for (const child of node.children) {
    const found = findPaneContainingTab(child, tabId);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function pushStateToWindow(windowId: number): void {
  // Re-export for use by index.ts
  const win = BrowserWindow.fromId(windowId);
  const state = appState.windows[windowId];
  if (win !== null && !win.isDestroyed() && state !== undefined) {
    win.webContents.send("state-updated", state);
  }
}

// ─── Layout tree helpers ──────────────────────────────────

function removeTabFromLayout(node: LayoutNode, tabId: string): boolean {
  if (node.type === "pane") {
    const idx = node.tabIds.indexOf(tabId);
    if (idx === -1) return false;
    node.tabIds.splice(idx, 1);
    if (node.activeTabId === tabId) {
      node.activeTabId = node.tabIds[0] ?? "";
    }
    return true;
  }

  // SplitNode
  for (let i = 0; i < node.children.length; i++) {
    if (removeTabFromLayout(node.children[i], tabId)) {
      // If child is now an empty pane, remove it
      const child = node.children[i];
      if (child.type === "pane" && child.tabIds.length === 0) {
        node.children.splice(i, 1);
        node.sizes.splice(i, 1);
        // Redistribute sizes evenly
        const n = node.sizes.length;
        if (n > 0) {
          const each = 100 / n;
          node.sizes = Array(n).fill(each);
        }
      }
      return true;
    }
  }
  return false;
}

function insertTabIntoLayout(
  node: LayoutNode,
  tabId: string,
  insertBeforeTabId?: string,
  targetPaneId?: string,
): boolean {
  if (node.type === "pane") {
    const paneId = node.tabIds[0] ?? "__empty__";
    if (targetPaneId !== undefined && paneId !== targetPaneId) return false;
    if (insertBeforeTabId !== undefined) {
      const idx = node.tabIds.indexOf(insertBeforeTabId);
      if (idx !== -1) {
        node.tabIds.splice(idx, 0, tabId);
        node.activeTabId = tabId;
        return true;
      }
    }
    // Append if no insert position or insert target not found
    node.tabIds.push(tabId);
    node.activeTabId = tabId;
    return true;
  }

  // SplitNode
  for (let i = node.children.length - 1; i >= 0; i--) {
    if (insertTabIntoLayout(node.children[i], tabId, insertBeforeTabId, targetPaneId)) {
      return true;
    }
  }
  return false;
}
