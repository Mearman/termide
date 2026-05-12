import React, { useState, useEffect, useCallback, useRef } from "react";
import type { WindowStateFromMain, LayoutNode, Tab, PaneNode, SplitNode } from "./types.ts";
import { Pane } from "./components/Pane.tsx";

const electron = window.electronAPI;

export function App(): React.ReactElement | null {
  const [windowId, setWindowId] = useState<number>(-1);
  const [state, setState] = useState<WindowStateFromMain | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (electron === undefined) {
      setError("electronAPI not available — preload script did not load");
      return;
    }
    const id = electron.getWindowId();
    setWindowId(id);
    const initial = electron.getInitialState();
    if (initial !== undefined) {
      setState(initial);
    }
  }, []);

  // Listen for state pushes from main process
  useEffect(() => {
    const unsub = electron.onStateUpdated((newState) => {
      setState(newState);
    });
    return unsub;
  }, []);

  const pushLayout = useCallback(
    (newLayout: LayoutNode) => {
      if (state === undefined) return;
      setState({ ...state, layout: newLayout });
      electron.tabMovedIntra({ windowId, layout: newLayout });
    },
    [state, windowId],
  );

  const handleSetActiveTab = useCallback(
    (panePath: string, tabId: string) => {
      if (state === undefined) return;
      const newLayout = setActiveTabInTree(state.layout, panePath, tabId);
      pushLayout(newLayout);
    },
    [state, pushLayout],
  );

  const handleReorderTabs = useCallback(
    (panePath: string, tabId: string, fromIndex: number, toIndex: number) => {
      if (state === undefined) return;
      if (fromIndex === toIndex) return;
      const newLayout = reorderTabsInPane(state.layout, panePath, tabId, fromIndex, toIndex);
      if (newLayout !== undefined) {
        pushLayout(newLayout);
      }
    },
    [state, pushLayout],
  );

  const handleMoveTabBetweenPanes = useCallback(
    (tabId: string, fromPath: string, toPath: string, insertBeforeTabId?: string) => {
      if (state === undefined) return;
      if (fromPath === toPath) return;

      const newLayout = moveTabBetweenPanes(
        state.layout,
        tabId,
        fromPath,
        toPath,
        insertBeforeTabId,
      );
      if (newLayout !== undefined) {
        pushLayout(newLayout);
      }
    },
    [state, pushLayout],
  );

  const handleCopyTabToPane = useCallback(
    (tabId: string, toPath: string, insertBeforeTabId?: string) => {
      if (state === undefined) return;
      const sourceTab = state.tabs[tabId];
      if (sourceTab === undefined) return;

      // Create a duplicate tab with a new ID
      const newId = `tab-copy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newTab: Tab = { ...sourceTab, id: newId };

      const newTabs = { ...state.tabs, [newId]: newTab };
      const newLayout = insertTabIntoPane(state.layout, toPath, newId, insertBeforeTabId);
      if (newLayout !== undefined) {
        setState({ ...state, layout: newLayout, tabs: newTabs });
        electron.tabMovedIntra({ windowId, layout: newLayout });
      }
    },
    [state, windowId],
  );

  const handleSplitPane = useCallback(
    (tabId: string, sourcePath: string, targetPath: string, direction: "row" | "column") => {
      if (state === undefined) return;

      let layout = state.layout;

      // If the tab is from a different pane, move it first
      if (sourcePath !== targetPath) {
        const movedLayout = moveTabBetweenPanes(layout, tabId, sourcePath, targetPath);
        if (movedLayout === undefined) return;
        layout = movedLayout;
      }

      // Now split at the target path
      const newLayout = splitPane(layout, targetPath, tabId, direction);
      if (newLayout !== undefined) {
        pushLayout(newLayout);
      }
    },
    [state, pushLayout],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (state === undefined) return;
      const newLayout = closeTabInTree(state.layout, tabId);
      if (newLayout !== undefined) {
        const newTabs = { ...state.tabs };
        delete newTabs[tabId];
        setState({ ...state, layout: newLayout, tabs: newTabs });
        electron.tabMovedIntra({ windowId, layout: newLayout });
      }
    },
    [state, windowId],
  );

  const handleResize = useCallback(
    (splitPath: string, childIndex: number, deltaPx: number) => {
      if (state === undefined) return;
      const cloned = structuredClone(state.layout);
      const split = findSplitAtPath(cloned, splitPath);
      if (split === undefined) return;

      const sizes = [...split.sizes];
      const totalSize = sizes.reduce((sum, s) => sum + s, 0);
      // Estimate container size from the flex percentages
      // deltaPx is relative, so convert to percentage
      const pxToPercent = totalSize > 0 ? (deltaPx / totalSize) * 2 : 0;
      const minSize = 5;
      const transfer = Math.min(
        Math.max(pxToPercent, -(sizes[childIndex]! - minSize)),
        sizes[childIndex + 1]! - minSize,
      );

      sizes[childIndex] = (sizes[childIndex] ?? 50) + transfer;
      sizes[childIndex + 1] = (sizes[childIndex + 1] ?? 50) - transfer;
      split.sizes = sizes;

      pushLayout(cloned);
    },
    [state, pushLayout],
  );

  const handleTogglePin = useCallback(
    (tabId: string) => {
      window.electronAPI.toggleTabPin(tabId);
    },
    [],
  );

  if (error !== undefined) {
    return <div style={{ padding: 20, color: "#c75d5d" }}>Error: {error}</div>;
  }

  if (state === undefined) {
    return <div style={{ padding: 20, color: "#a6adc8" }}>Loading…</div>;
  }

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <LayoutRenderer
        node={state.layout}
        tabs={state.tabs}
        windowId={windowId}
        onSetActiveTab={handleSetActiveTab}
        onReorderTabs={handleReorderTabs}
        onMoveTabBetweenPanes={handleMoveTabBetweenPanes}
        onCopyTabToPane={handleCopyTabToPane}
        onSplitPane={handleSplitPane}
        onCloseTab={handleCloseTab}
        onTogglePin={handleTogglePin}
        onResize={handleResize}
      />
    </div>
  );
}

// ─── Layout tree rendering ────────────────────────────────

interface LayoutRendererProps {
  node: LayoutNode;
  tabs: Record<string, Tab>;
  windowId: number;
  onSetActiveTab: (panePath: string, tabId: string) => void;
  onReorderTabs: (panePath: string, tabId: string, fromIndex: number, toIndex: number) => void;
  onMoveTabBetweenPanes: (tabId: string, fromPath: string, toPath: string, insertBeforeTabId?: string) => void;
  onCopyTabToPane: (tabId: string, toPath: string, insertBeforeTabId?: string) => void;
  onSplitPane: (tabId: string, sourcePath: string, targetPath: string, direction: "row" | "column") => void;
  onCloseTab: (tabId: string) => void;
  onTogglePin: (tabId: string) => void;
  onResize?: (splitPath: string, index: number, deltaPx: number) => void;
  path?: string;
}

function LayoutRenderer({
  node,
  tabs,
  windowId,
  onSetActiveTab,
  onReorderTabs,
  onMoveTabBetweenPanes,
  onSplitPane,
  onCloseTab,
  onTogglePin,
  onCopyTabToPane,
  onResize,
  path = "root",
}: LayoutRendererProps): React.ReactElement {
  if (node.type === "pane") {
    return (
      <Pane
        pane={node}
        tabs={tabs}
        windowId={windowId}
        path={path}
        onSetActiveTab={(tabId) => onSetActiveTab(path, tabId)}
        onReorderTabs={(tabId, from, to) => onReorderTabs(path, tabId, from, to)}
        onMoveTabBetweenPanes={onMoveTabBetweenPanes}
        onCopyTabToPane={onCopyTabToPane}
        onSplitPane={(tabId, source, dir) => onSplitPane(tabId, source, path, dir)}
        onCloseTab={onCloseTab}
        onTogglePin={onTogglePin}
      />
    );
  }

  const childCount = node.children.length;

  return (
    <div
      data-testid="split"
      data-split-path={path}
      data-direction={node.direction}
      style={{
        display: "flex",
        flexDirection: node.direction === "row" ? "row" : "column",
        height: "100%",
        width: "100%",
      }}
    >
      {node.children.map((child, i) => (
        <React.Fragment key={`${path}-${i}`}>
          <div
            style={{
              flex: (node.sizes[i] ?? 50) / 100,
              overflow: "hidden",
            }}
          >
            <LayoutRenderer
              node={child}
              tabs={tabs}
              windowId={windowId}
              onSetActiveTab={onSetActiveTab}
              onReorderTabs={onReorderTabs}
              onMoveTabBetweenPanes={onMoveTabBetweenPanes}
              onCopyTabToPane={onCopyTabToPane}
              onSplitPane={onSplitPane}
              onCloseTab={onCloseTab}
              onTogglePin={onTogglePin}
              onResize={onResize}
              path={`${path}.${i}`}
            />
          </div>
          {/* Resize handle between children */}
          {i < childCount - 1 && (
            <ResizeHandle
              direction={node.direction}
              onResize={(delta) => onResize?.(`${path}`, i, delta)}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Layout tree mutations ────────────────────────────────

function setActiveTabInTree(
  node: LayoutNode,
  panePath: string,
  tabId: string,
): LayoutNode {
  if (node.type === "pane") {
    if (panePath !== "root" && !panePath.includes(".")) return node;
    return { ...node, activeTabId: tabId };
  }

  return {
    ...node,
    children: node.children.map((child, i) =>
      setActiveTabInTree(child, `${panePath}.${i}`, tabId),
    ),
  };
}

/**
 * Reorder tabs within a single pane. fromIndex and toIndex are positions
 * within the tabIds array. The tab at fromIndex is moved to toIndex.
 */
function reorderTabsInPane(
  root: LayoutNode,
  panePath: string,
  tabId: string,
  fromIndex: number,
  toIndex: number,
): LayoutNode | undefined {
  const cloned = structuredClone(root);
  const pane = findPaneAtPath(cloned, panePath);
  if (pane === undefined) return undefined;

  // Verify the tab is at the expected index
  if (pane.tabIds[fromIndex] !== tabId) return undefined;

  // Remove from old position, insert at new position
  pane.tabIds.splice(fromIndex, 1);
  pane.tabIds.splice(toIndex, 0, tabId);
  pane.activeTabId = tabId;

  return cloned;
}

/**
 * Move a tab from one pane to another within the same window's layout tree.
 */
function moveTabBetweenPanes(
  root: LayoutNode,
  tabId: string,
  fromPath: string,
  toPath: string,
  insertBeforeTabId?: string,
): LayoutNode | undefined {
  const cloned = structuredClone(root);

  const sourcePane = findPaneAtPath(cloned, fromPath);
  if (sourcePane === undefined) return undefined;

  const tabIdx = sourcePane.tabIds.indexOf(tabId);
  if (tabIdx === -1) return undefined;

  sourcePane.tabIds.splice(tabIdx, 1);
  // Remove from source pinned list if pinned
  const wasPinned = sourcePane.pinnedTabIds.includes(tabId);
  if (wasPinned) {
    sourcePane.pinnedTabIds.splice(sourcePane.pinnedTabIds.indexOf(tabId), 1);
  }
  if (sourcePane.activeTabId === tabId) {
    sourcePane.activeTabId = sourcePane.tabIds[0] ?? "";
  }

  const targetPane = findPaneAtPath(cloned, toPath);
  if (targetPane === undefined) return undefined;

  if (insertBeforeTabId !== undefined) {
    const beforeIdx = targetPane.tabIds.indexOf(insertBeforeTabId);
    if (beforeIdx !== -1) {
      targetPane.tabIds.splice(beforeIdx, 0, tabId);
    } else {
      targetPane.tabIds.push(tabId);
    }
  } else {
    targetPane.tabIds.push(tabId);
  }
  targetPane.activeTabId = tabId;
  // Preserve pinned status in new pane
  if (wasPinned) {
    targetPane.pinnedTabIds.push(tabId);
    reorderPinnedFirst(targetPane);
  }

  return cleanupEmptyPanes(cloned);
}

/**
 * Split a pane: remove the given tab from the pane, wrap the pane
 * in a new SplitNode with a second child pane containing just that tab.
 */
function splitPane(
  root: LayoutNode,
  panePath: string,
  tabId: string,
  direction: "row" | "column",
): LayoutNode | undefined {
  const cloned = structuredClone(root);
  const pane = findPaneAtPath(cloned, panePath);
  if (pane === undefined) return undefined;

  const tabIdx = pane.tabIds.indexOf(tabId);
  if (tabIdx === -1) return undefined;

  // Remove the tab from the original pane
  pane.tabIds.splice(tabIdx, 1);
  if (pane.activeTabId === tabId) {
    pane.activeTabId = pane.tabIds[0] ?? "";
  }

  // Create a new child pane with just the split-off tab
  const newChild: PaneNode = {
    type: "pane",
    tabIds: [tabId],
    pinnedTabIds: [],
    activeTabId: tabId,
  };

  // Replace the original pane in the tree with a split containing
  // the original pane (minus the tab) and the new child pane
  const split: SplitNode = {
    type: "split",
    direction,
    sizes: [50, 50],
    children: [
      pane.tabIds.length > 0 ? { ...pane } : newChild,
      pane.tabIds.length > 0 ? newChild : { ...pane },
    ],
  };

  // If the original pane is now empty, both children are just the new tab
  if (pane.tabIds.length === 0) {
    // Don't split — the whole pane becomes just the tab
    // (This shouldn't normally happen but is a safety fallback)
    return cloned;
  }

  // Replace the pane at panePath with the split
  if (!replaceNodeAtPath(cloned, panePath, split)) {
    return undefined;
  }

  return cloned;
}

/**
 * Navigate the layout tree by dot-separated path (e.g. "root.0.1").
 */
function findPaneAtPath(node: LayoutNode, path: string): PaneNode | undefined {
  const segments = path.split(".");
  let current: LayoutNode = node;

  for (const segment of segments) {
    if (segment === "root") continue;
    const idx = parseInt(segment, 10);
    if (isNaN(idx)) return undefined;

    if (current.type === "pane") return current;

    const child = current.children[idx];
    if (child === undefined) return undefined;
    current = child;
  }

  return current.type === "pane" ? current : undefined;
}

/**
 * Replace the node at the given path with a new node.
 * Mutates the tree in place (caller should structuredClone first).
 */
function replaceNodeAtPath(root: LayoutNode, path: string, replacement: LayoutNode): boolean {
  const segments = path.split(".");
  // Navigate to the parent of the target
  let current: LayoutNode = root;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (segment === "root") continue;
    const idx = parseInt(segment, 10);
    if (isNaN(idx)) return false;

    // If this is the last segment, replace the child
    if (i === segments.length - 1) {
      if (current.type === "split") {
        current.children[idx] = replacement;
        return true;
      }
      return false;
    }

    if (current.type === "pane") return false;
    const child = current.children[idx];
    if (child === undefined) return false;
    current = child;
  }

  return false;
}

function cleanupEmptyPanes(node: LayoutNode): LayoutNode {
  if (node.type === "pane") return node;

  const cleanedChildren = node.children
    .map(cleanupEmptyPanes)
    .filter((child) => {
      if (child.type === "pane" && child.tabIds.length === 0) return false;
      return true;
    });

  if (cleanedChildren.length === 1) {
    return cleanedChildren[0]!;
  }

  const n = cleanedChildren.length;
  const each = 100 / n;
  return {
    ...node,
    children: cleanedChildren,
    sizes: Array(n).fill(each),
  };
}

/**
 * Reorder tabIds so pinned tabs come first, maintaining relative order.
 */
function reorderPinnedFirst(pane: PaneNode): void {
  const pinned = pane.pinnedTabIds.filter((id) => pane.tabIds.includes(id));
  const unpinned = pane.tabIds.filter((id) => !pane.pinnedTabIds.includes(id));
  pane.tabIds = [...pinned, ...unpinned];
}

/**
 * Close a tab: remove it from whichever pane contains it.
 * Collapse the tree if the parent split has fewer than 2 children left.
 */
function closeTabInTree(root: LayoutNode, tabId: string): LayoutNode | undefined {
  const cloned = structuredClone(root);
  const pane = findPaneContainingTab(cloned, tabId);
  if (pane === undefined) return undefined;

  const idx = pane.tabIds.indexOf(tabId);
  if (idx === -1) return undefined;

  pane.tabIds.splice(idx, 1);
  if (pane.activeTabId === tabId) {
    // Activate the next tab (prefer the one to the right, else left)
    pane.activeTabId = pane.tabIds[Math.min(idx, pane.tabIds.length - 1)] ?? "";
  }

  return cleanupEmptyPanes(cloned);
}

/**
 * Insert a tab ID into a pane at the given path, optionally before another tab.
 * Unlike moveTabBetweenPanes, this does NOT remove from source.
 */
function insertTabIntoPane(
  root: LayoutNode,
  panePath: string,
  tabId: string,
  insertBeforeTabId?: string,
): LayoutNode | undefined {
  const cloned = structuredClone(root);
  const targetPane = findPaneAtPath(cloned, panePath);
  if (targetPane === undefined) return undefined;

  if (insertBeforeTabId !== undefined) {
    const beforeIdx = targetPane.tabIds.indexOf(insertBeforeTabId);
    if (beforeIdx !== -1) {
      targetPane.tabIds.splice(beforeIdx, 0, tabId);
    } else {
      targetPane.tabIds.push(tabId);
    }
  } else {
    targetPane.tabIds.push(tabId);
  }
  targetPane.activeTabId = tabId;
  return cloned;
}

/**
 * Navigate the layout tree by dot-separated path and return the SplitNode.
 */
function findSplitAtPath(node: LayoutNode, path: string): SplitNode | undefined {
  const segments = path.split(".");
  let current: LayoutNode = node;

  for (const segment of segments) {
    if (segment === "root") continue;
    const idx = parseInt(segment, 10);
    if (isNaN(idx)) return undefined;
    if (current.type === "pane") return undefined;
    const child = current.children[idx];
    if (child === undefined) return undefined;
    current = child;
  }

  return current.type === "split" ? current : undefined;
}

/**
 * Find the pane that contains the given tab ID.
 */
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

// ─── Resize handle ────────────────────────────────────────

interface ResizeHandleProps {
  direction: "row" | "column";
  onResize: (deltaPx: number) => void;
}

function ResizeHandle({ direction, onResize }: ResizeHandleProps): React.ReactElement {
  const [active, setActive] = useState(false);
  const startPos = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setActive(true);
      startPos.current = direction === "row" ? e.clientX : e.clientY;

      const handleMouseMove = (moveE: MouseEvent): void => {
        const currentPos = direction === "row" ? moveE.clientX : moveE.clientY;
        const delta = currentPos - startPos.current;
        startPos.current = currentPos;
        onResize(delta);
      };

      const handleMouseUp = (): void => {
        setActive(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [direction, onResize],
  );

  return (
    <div
      className={`resize-handle resize-handle-${direction}${active ? " active" : ""}`}
      onMouseDown={handleMouseDown}
    />
  );
}
