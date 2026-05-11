import { useState, useEffect, useCallback } from "react";
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
        onMoveTabBetweenPanes={handleMoveTabBetweenPanes}
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
  onMoveTabBetweenPanes: (tabId: string, fromPath: string, toPath: string, insertBeforeTabId?: string) => void;
  path?: string;
}

function LayoutRenderer({
  node,
  tabs,
  windowId,
  onSetActiveTab,
  onMoveTabBetweenPanes,
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
        onMoveTabBetweenPanes={onMoveTabBetweenPanes}
      />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: node.direction === "row" ? "row" : "column",
        height: "100%",
        width: "100%",
        gap: 2,
      }}
    >
      {node.children.map((child, i) => (
        <div
          key={`${path}-${i}`}
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
            onMoveTabBetweenPanes={onMoveTabBetweenPanes}
            path={`${path}.${i}`}
          />
        </div>
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
    // Path doesn't identify this pane uniquely, but the click handler
    // already knows the correct pane — just set the active tab
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
 * Move a tab from one pane to another within the same window's layout tree.
 * Returns a new layout tree, or undefined if the move didn't change anything.
 */
function moveTabBetweenPanes(
  root: LayoutNode,
  tabId: string,
  fromPath: string,
  toPath: string,
  insertBeforeTabId?: string,
): LayoutNode | undefined {
  // Deep clone the tree so we can mutate it
  const cloned = structuredClone(root);

  // 1. Find the source pane and remove the tab
  const sourcePane = findPaneAtPath(cloned, fromPath);
  if (sourcePane === undefined) return undefined;

  const tabIdx = sourcePane.tabIds.indexOf(tabId);
  if (tabIdx === -1) return undefined;

  sourcePane.tabIds.splice(tabIdx, 1);
  if (sourcePane.activeTabId === tabId) {
    sourcePane.activeTabId = sourcePane.tabIds[0] ?? "";
  }

  // 2. Find the target pane and insert the tab
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

  // 3. Clean up empty panes
  return cleanupEmptyPanes(cloned);
}

/**
 * Navigate the layout tree by dot-separated path (e.g. "root.0.1").
 */
function findPaneAtPath(node: LayoutNode, path: string): PaneNode | undefined {
  const segments = path.split(".");
  // Skip "root" prefix
  let current: LayoutNode = node;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === "root") continue;
    const idx = parseInt(segment, 10);
    if (isNaN(idx)) return undefined;

    if (current.type === "pane") {
      // Can't go deeper into a pane
      return current;
    }

    const child = current.children[idx];
    if (child === undefined) return undefined;
    current = child;
  }

  return current.type === "pane" ? current : undefined;
}

/**
 * Remove empty panes from split nodes, cleaning up the tree.
 * If a split node ends up with one child, replace it with that child.
 */
function cleanupEmptyPanes(node: LayoutNode): LayoutNode {
  if (node.type === "pane") return node;

  const cleanedChildren = node.children
    .map(cleanupEmptyPanes)
    .filter((child) => {
      // Remove empty panes
      if (child.type === "pane" && child.tabIds.length === 0) return false;
      return true;
    });

  // If only one child remains, collapse the split
  if (cleanedChildren.length === 1) {
    return cleanedChildren[0]!;
  }

  // Redistribute sizes evenly
  const n = cleanedChildren.length;
  const each = 100 / n;
  return {
    ...node,
    children: cleanedChildren,
    sizes: Array(n).fill(each),
  };
}
