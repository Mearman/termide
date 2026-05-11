/**
 * Canonical application state. Lives in the main process.
 * Every mutation happens here; renderers receive snapshots.
 */
import type { AppState, LayoutNode, PaneNode, SplitNode, Tab } from "./types";

let nextTabId = 1;
function makeTabId(): string {
  return `tab-${nextTabId++}`;
}

function makeTab(title: string, colour: string): Tab {
  return { id: makeTabId(), title, colour };
}

// Initial demo tabs
const tabs: AppState["allTabs"] = {};
const demoTabs = [
  makeTab("README.md", "#4a90d9"),
  makeTab("index.ts", "#7bc67e"),
  makeTab("styles.css", "#d4a05a"),
  makeTab("package.json", "#c75d5d"),
  makeTab("config.ts", "#9b6dbf"),
  makeTab("utils.ts", "#5db8a0"),
];
for (const t of demoTabs) {
  tabs[t.id] = t;
}

function makePane(...tabIds: string[]): PaneNode {
  return {
    type: "pane",
    tabIds,
    activeTabId: tabIds[0],
  };
}

const initialLayout: SplitNode = {
  type: "split",
  direction: "row",
  sizes: [50, 50],
  children: [
    makePane(demoTabs[0].id, demoTabs[1].id, demoTabs[2].id),
    makePane(demoTabs[3].id, demoTabs[4].id, demoTabs[5].id),
  ],
};

export const appState: AppState = {
  allTabs: tabs,
  windows: {},
};

export function registerWindow(windowId: number): void {
  appState.windows[windowId] = {
    windowId,
    layout: initialLayout,
    tabs: { ...tabs },
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
  options: { insertBeforeTabId?: string },
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
  insertTabIntoLayout(toState.layout, tabId, options.insertBeforeTabId);

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
    layout: { type: "pane", tabIds: [tabId], activeTabId: tabId },
    tabs: { [tabId]: tab },
  };
}

/**
 * Update a window's layout after an intra-window tab move.
 */
export function updateWindowLayout(
  windowId: number,
  newLayout: LayoutNode,
): void {
  const state = appState.windows[windowId];
  if (state !== undefined) {
    state.layout = newLayout;
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
): boolean {
  if (node.type === "pane") {
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

  // SplitNode — try children in reverse order (rightmost/bottom first)
  for (let i = node.children.length - 1; i >= 0; i--) {
    if (insertTabIntoLayout(node.children[i], tabId, insertBeforeTabId)) {
      return true;
    }
  }
  return false;
}
