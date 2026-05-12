import React, { useState, useEffect, useCallback } from "react";
import { Mosaic, type MosaicNode, type MosaicPath } from "react-mosaic-component";
import type { WindowStateFromMain, LayoutNode, Tab, PaneNode, SplitNode } from "./types.ts";

const electron = window.electronAPI;

// ─── Layout tree ↔ MosaicNode conversion ──────────────────

/**
 * Convert our internal LayoutNode tree to react-mosaic v7's MosaicNode.
 *
 * Mapping:
 * - PaneNode with 1 tab → leaf node (just the tab ID string)
 * - PaneNode with N tabs → MosaicTabsNode
 * - SplitNode → MosaicSplitNode (sizes → splitPercentages)
 */
function toMosaicNode(layout: LayoutNode): MosaicNode<string> {
  if (layout.type === "pane") {
    const nonPinned = layout.tabIds.filter((id) => !layout.pinnedTabIds.includes(id));
    const pinned = layout.pinnedTabIds.filter((id) => layout.tabIds.includes(id));
    const ordered = [...pinned, ...nonPinned];

    if (ordered.length <= 1) {
      // Single tab (or empty) → leaf node
      return ordered[0] ?? "";
    }

    return {
      type: "tabs",
      tabs: ordered,
      activeTabIndex: ordered.indexOf(layout.activeTabId),
    };
  }

  return {
    type: "split",
    direction: layout.direction,
    children: layout.children.map(toMosaicNode),
    splitPercentages: layout.sizes.length > 0 ? layout.sizes : undefined,
  };
}

/**
 * Convert a react-mosaic MosaicNode back to our internal LayoutNode.
 * Reconstructs pinnedTabIds by looking up tab.pinned from the tabs dictionary.
 */
function fromMosaicNode(
  mosaic: MosaicNode<string>,
  tabs: Record<string, Tab>,
): LayoutNode {
  // Leaf node (single tab ID string)
  if (typeof mosaic === "string") {
    const tab = tabs[mosaic];
    return {
      type: "pane",
      tabIds: mosaic !== "" ? [mosaic] : [],
      pinnedTabIds: tab?.pinned === true ? [mosaic] : [],
      activeTabId: mosaic,
    };
  }

  if (mosaic.type === "tabs") {
    const tabIds = [...mosaic.tabs];
    const pinnedTabIds = tabIds.filter((id) => tabs[id]?.pinned === true);
    const activeIdx = mosaic.activeTabIndex;
    return {
      type: "pane",
      tabIds,
      pinnedTabIds,
      activeTabId: tabIds[activeIdx] ?? tabIds[0] ?? "",
    };
  }

  // MosaicSplitNode
  return {
    type: "split",
    direction: mosaic.direction,
    children: mosaic.children.map((child) => fromMosaicNode(child, tabs)),
    sizes: mosaic.splitPercentages ?? Array(mosaic.children.length).fill(100 / mosaic.children.length),
  };
}

/**
 * Find all tab IDs referenced anywhere in a MosaicNode tree.
 */
function collectTabIds(mosaic: MosaicNode<string>): string[] {
  if (typeof mosaic === "string") return mosaic !== "" ? [mosaic] : [];
  if (mosaic.type === "tabs") return [...mosaic.tabs];
  return mosaic.children.flatMap(collectTabIds);
}

// ─── App component ────────────────────────────────────────

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

  // ─── Mosaic onChange: sync layout back to main process ──

  const handleMosaicChange = useCallback(
    (newMosaic: MosaicNode<string> | null) => {
      if (state === undefined || newMosaic === null) return;

      const newLayout = fromMosaicNode(newMosaic, state.tabs);

      // Collect all tab IDs in the new layout and remove orphaned tabs
      const referencedIds = new Set(collectTabIds(newMosaic));
      const newTabs: Record<string, Tab> = {};
      for (const [id, tab] of Object.entries(state.tabs)) {
        if (referencedIds.has(id)) {
          newTabs[id] = tab;
        }
      }

      setState({ ...state, layout: newLayout, tabs: newTabs });
      electron.tabMovedIntra({ windowId, layout: newLayout });
    },
    [state, windowId],
  );

  // ─── Cross-window drag ─────────────────────────────────

  const handleTabDragStart = useCallback(
    (tabId: string, tabTitle: string, tabColour: string) => {
      const tab = state?.tabs[tabId];
      if (tab === undefined) return;
      electron.tabDragBegin({
        windowId,
        tabId,
        tabTitle,
        tabColour,
        tabBounds: { x: 0, y: 0, width: 0, height: 0 },
      });
    },
    [windowId, state],
  );

  const handleTabDragEnd = useCallback((completed: boolean) => {
    electron.tabDragEnd(completed);
  }, []);

  // ─── Tab actions ────────────────────────────────────────

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (state === undefined) return;
      // Find and remove the tab from the layout
      const mosaic = toMosaicNode(state.layout);
      const newMosaic = removeTabFromMosaic(mosaic, tabId);
      if (newMosaic === undefined) return;
      const newLayout = fromMosaicNode(newMosaic, state.tabs);
      const newTabs = { ...state.tabs };
      delete newTabs[tabId];
      setState({ ...state, layout: newLayout, tabs: newTabs });
      electron.tabMovedIntra({ windowId, layout: newLayout });
    },
    [state, windowId],
  );

  if (error !== undefined) {
    return <div style={{ padding: 20, color: "#c75d5d" }}>Error: {error}</div>;
  }

  if (state === undefined) {
    return <div style={{ padding: 20, color: "#a6adc8" }}>Loading…</div>;
  }

  const mosaicNode = toMosaicNode(state.layout);

  return (
    <div className="mosaic-root-container">
      <Mosaic<string>
        value={mosaicNode}
        onChange={handleMosaicChange}
        renderTile={(tabId: string, path: MosaicPath) => (
          <TileContent
            tabId={tabId}
            tabs={state.tabs}
            path={path}
            onDragStart={handleTabDragStart}
            onDragEnd={handleTabDragEnd}
            onClose={handleCloseTab}
          />
        )}
        className="mosaic-blueprint-theme"
        resize={{ minimumPaneSizePercentage: 5 }}
      />
    </div>
  );
}

// ─── Tile content renderer ────────────────────────────────

interface TileContentProps {
  tabId: string;
  tabs: Record<string, Tab>;
  path: MosaicPath;
  onDragStart: (tabId: string, title: string, colour: string) => void;
  onDragEnd: (completed: boolean) => void;
  onClose: (tabId: string) => void;
}

function TileContent({
  tabId,
  tabs,
  onDragStart,
  onDragEnd,
  onClose,
}: TileContentProps): React.ReactElement {
  const tab = tabs[tabId];
  const title = tab?.title ?? tabId;
  const colour = tab?.colour ?? "#888";

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "copyMove";
      e.dataTransfer.setData("text/plain", tabId);
      onDragStart(tabId, title, colour);
    },
    [tabId, title, colour, onDragStart],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent) => {
      const completed = e.dataTransfer.dropEffect === "none";
      onDragEnd(completed);
    },
    [onDragEnd],
  );

  return (
    <div className="mosaic-tile-content">
      {/* Toolbar with tab title and close button */}
      <div className="tile-toolbar">
        <span
          className="tile-drag-handle"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <span className="tab-colour" style={{ background: colour }} />
          <span className="tile-title">{title}</span>
          {tab?.pinned && <span className="tile-badge">📌</span>}
          {tab?.preview && <span className="tile-badge preview-badge">preview</span>}
          {tab?.dirty && <span className="tile-badge dirty-badge">●</span>}
        </span>
        <button
          className="tile-close-button"
          onClick={() => onClose(tabId)}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose(tabId);
            }
          }}
          onContextMenu={(e) => {
            e.stopPropagation();
            window.electronAPI.toggleTabDirty(tabId);
          }}
        >
          {tab?.dirty ? "●" : "×"}
        </button>
      </div>

      {/* Content area */}
      <div className="tile-body">
        <div className="content-header">
          <span className="content-colour-dot" style={{ backgroundColor: colour }} />
          <span className="content-title">{title}</span>
          {tab?.pinned && <span className="content-badge pinned">pinned</span>}
          {tab?.preview && <span className="content-badge preview">preview</span>}
          {tab?.dirty && <span className="content-badge dirty">modified</span>}
          <button
            className="content-action-button"
            onClick={() => window.electronAPI.toggleTabDirty(tabId)}
          >
            {tab?.dirty ? "Save" : "Edit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mosaic tree mutation helpers ─────────────────────────

/**
 * Remove a tab from anywhere in the mosaic tree.
 * Returns undefined if the tab wasn't found.
 */
function removeTabFromMosaic(
  node: MosaicNode<string>,
  tabId: string,
): MosaicNode<string> | undefined {
  if (typeof node === "string") {
    return node === tabId ? undefined : node;
  }

  if (node.type === "tabs") {
    const idx = node.tabs.indexOf(tabId);
    if (idx === -1) return node;

    const newTabs = node.tabs.filter((t) => t !== tabId);
    if (newTabs.length === 0) return undefined;
    if (newTabs.length === 1) return newTabs[0]!;

    const newActive = Math.min(node.activeTabIndex, newTabs.length - 1);
    return { ...node, tabs: newTabs, activeTabIndex: newActive };
  }

  // Split node
  const newChildren = node.children
    .map((child) => removeTabFromMosaic(child, tabId))
    .filter((c): c is MosaicNode<string> => c !== undefined);

  if (newChildren.length === 0) return undefined;
  if (newChildren.length === 1) return newChildren[0]!;

  const n = newChildren.length;
  return {
    ...node,
    children: newChildren,
    splitPercentages: node.splitPercentages ?? Array(n).fill(100 / n),
  };
}
