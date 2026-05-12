import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Mosaic,
  type MosaicNode,
} from "react-mosaic-component";
import type { WindowStateFromMain, LayoutNode, Tab } from "./types.ts";

const electron = window.electronAPI;

// ─── Layout tree ↔ MosaicNode conversion ──────────────────

function toMosaicNode(layout: LayoutNode): MosaicNode<string> {
  if (layout.type === "pane") {
    const nonPinned = layout.tabIds.filter((id) => !layout.pinnedTabIds.includes(id));
    const pinned = layout.pinnedTabIds.filter((id) => layout.tabIds.includes(id));
    const ordered = [...pinned, ...nonPinned];

    return {
      type: "tabs",
      tabs: ordered.length > 0 ? ordered : [""],
      activeTabIndex: Math.max(0, ordered.indexOf(layout.activeTabId)),
    };
  }

  return {
    type: "split",
    direction: layout.direction,
    children: layout.children.map(toMosaicNode),
    splitPercentages: layout.sizes.length > 0 ? layout.sizes : undefined,
  };
}

function fromMosaicNode(
  mosaic: MosaicNode<string>,
  tabs: Record<string, Tab>,
): LayoutNode {
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

  return {
    type: "split",
    direction: mosaic.direction,
    children: mosaic.children.map((child) => fromMosaicNode(child, tabs)),
    sizes: mosaic.splitPercentages ?? Array(mosaic.children.length).fill(100 / mosaic.children.length),
  };
}

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
  const [contextMenu, setContextMenu] = useState<
    { tabId: string; x: number; y: number } | undefined
  >(undefined);

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

  useEffect(() => {
    const unsub = electron.onStateUpdated((newState) => {
      setState(newState);
    });
    return unsub;
  }, []);

  const mosaicRootRef = useRef<HTMLDivElement>(null);

  // ─── Mosaic onChange: sync layout back to main process ──

  const handleMosaicChange = useCallback(
    (newMosaic: MosaicNode<string> | null) => {
      if (state === undefined || newMosaic === null) return;

      const newLayout = fromMosaicNode(newMosaic, state.tabs);

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

  // ─── Cross-window drag hooks ────────────────────────────

  useEffect(() => {
    const el = mosaicRootRef.current;
    if (el === null) return;

    const handleDragStart = (e: DragEvent) => {
      const target = (e.target as HTMLElement).closest('.mosaic-tab-button[draggable="true"]');
      if (target === null) return;
      const tabId = target.getAttribute("title");
      if (tabId === null) return;

      const tab = state?.tabs[tabId];
      if (tab === undefined) return;

      electron.tabDragBegin({
        windowId,
        tabId,
        tabTitle: tab.title,
        tabColour: tab.colour,
        tabBounds: { x: 0, y: 0, width: 0, height: 0 },
      });
    };

    const handleDragEnd = (e: DragEvent) => {
      const completed = e.dataTransfer?.dropEffect === "none";
      electron.tabDragEnd(completed);
    };

    el.addEventListener("dragstart", handleDragStart);
    el.addEventListener("dragend", handleDragEnd);
    return () => {
      el.removeEventListener("dragstart", handleDragStart);
      el.removeEventListener("dragend", handleDragEnd);
    };
  }, [state, windowId]);

  // ─── Middle-click to close tabs ─────────────────────────

  useEffect(() => {
    const el = mosaicRootRef.current;
    if (el === null) return;

    const handleAuxClick = (e: MouseEvent) => {
      if (e.button !== 1) return; // middle-click only
      const target = (e.target as HTMLElement).closest('.mosaic-tab-button[draggable="true"]');
      if (target === null) return;
      const tabId = target.getAttribute("title");
      if (tabId === null) return;
      e.preventDefault();
      handleCloseTab(tabId);
    };

    el.addEventListener("auxclick", handleAuxClick);
    return () => el.removeEventListener("auxclick", handleAuxClick);
  }, [state]);

  // ─── Right-click context menu ───────────────────────────

  useEffect(() => {
    const el = mosaicRootRef.current;
    if (el === null) return;

    const handleContextMenu = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('.mosaic-tab-button[draggable="true"]');
      if (target === null) return;
      const tabId = target.getAttribute("title");
      if (tabId === null) return;
      e.preventDefault();
      setContextMenu({ tabId, x: e.clientX, y: e.clientY });
    };

    // Click outside to close context menu
    const handleClick = () => setContextMenu(undefined);

    el.addEventListener("contextmenu", handleContextMenu);
    el.addEventListener("click", handleClick);
    return () => {
      el.removeEventListener("contextmenu", handleContextMenu);
      el.removeEventListener("click", handleClick);
    };
  }, []);

  // ─── Close tab handler ─────────────────────────────────

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (state === undefined) return;
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
    <div className="mosaic-root-container" ref={mosaicRootRef}>
      <Mosaic<string>
        value={mosaicNode}
        onChange={handleMosaicChange}
        renderTile={(tabId: string) => (
          <TileContent tabId={tabId} tabs={state.tabs} />
        )}
        renderTabTitle={(props: { tabKey: string }) => {
          const tab = state.tabs[props.tabKey];
          return tab !== undefined ? (
            <span className="mosaic-custom-tab-title">
              <span className="tab-colour" style={{ background: tab.colour }} />
              <span className="mosaic-tab-label">{tab.title}</span>
              {tab.pinned && <span className="mosaic-tab-badge">📌</span>}
              {tab.preview && <span className="mosaic-tab-badge preview-badge">preview</span>}
              {tab.dirty && <span className="mosaic-tab-badge dirty-badge">●</span>}
            </span>
          ) : (
            <span>{props.tabKey}</span>
          );
        }}
        canClose={() => "canClose"}
        className="mosaic-blueprint-theme"
        resize={{ minimumPaneSizePercentage: 5 }}
      />

      {/* Context menu overlay */}
      {contextMenu !== undefined && (
        <div
          className="tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="tab-context-item"
            onClick={() => {
              electron.toggleTabPin(contextMenu.tabId);
              setContextMenu(undefined);
            }}
          >
            {state.tabs[contextMenu.tabId]?.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            className="tab-context-item"
            onClick={() => {
              handleCloseTab(contextMenu.tabId);
              setContextMenu(undefined);
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tile content renderer ────────────────────────────────

function TileContent({
  tabId,
  tabs,
}: {
  tabId: string;
  tabs: Record<string, Tab>;
}): React.ReactElement {
  const tab = tabs[tabId];
  const title = tab?.title ?? tabId;
  const colour = tab?.colour ?? "#888";

  return (
    <div className="mosaic-tile-content">
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
