/**
 * Canonical application state. Lives in the main process.
 * Every mutation happens here; renderers receive snapshots.
 */
import type { AppState, LayoutNode, PaneNode, SplitNode, Tab } from "./types.ts";

let nextTabId = 1;
function makeTabId(): string {
  return `tab-${nextTabId++}`;
}

function makeTab(title: string, colour: string): Tab {
  return { id: makeTabId(), title, colour };
}

function makePane(...tabIds: string[]): PaneNode {
  return {
    type: "pane",
    tabIds,
    activeTabId: tabIds[0],
  };
}

export const appState: AppState = {
  allTabs: {},
  windows: {},
};

export function registerWindow(windowId: number): void {
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

  const layout: SplitNode = {
    type: "split",
    direction: "row",
    sizes: [50, 50],
    children: [
      makePane(windowDemoTabs[0].id, windowDemoTabs[1].id, windowDemoTabs[2].id),
      makePane(windowDemoTabs[3].id, windowDemoTabs[4].id, windowDemoTabs[5].id),
    ],
  };

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
