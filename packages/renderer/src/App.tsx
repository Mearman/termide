import React, { useState, useEffect, useCallback, useRef } from "react";
import type { LayoutNode, PaneNode, SplitNode, Tab, WindowStateFromMain } from "./types.ts";

const electron = window.electronAPI;

// ─── Tree mutation helpers ────────────────────────────────

function collectTabIds(node: LayoutNode): string[] {
  if (node.type === "pane") return [...node.tabIds];
  return node.children.flatMap(collectTabIds);
}

function cloneLayout(node: LayoutNode): LayoutNode {
  if (node.type === "pane") {
    return { type: "pane", tabIds: [...node.tabIds], pinnedTabIds: [...node.pinnedTabIds], activeTabId: node.activeTabId };
  }
  return { type: "split", direction: node.direction, children: node.children.map(cloneLayout), sizes: [...node.sizes] };
}

function findPane(node: LayoutNode, tabId: string): PaneNode | undefined {
  if (node.type === "pane") return node.tabIds.includes(tabId) ? node : undefined;
  for (const c of node.children) { const f = findPane(c, tabId); if (f) return f; }
  return undefined;
}

function removeTab(layout: LayoutNode, tabId: string): boolean {
  if (layout.type === "pane") {
    const idx = layout.tabIds.indexOf(tabId);
    if (idx === -1) return false;
    layout.tabIds.splice(idx, 1);
    layout.pinnedTabIds = layout.pinnedTabIds.filter(id => id !== tabId);
    if (layout.activeTabId === tabId) layout.activeTabId = layout.tabIds[0] ?? "";
    return true;
  }
  for (let i = 0; i < layout.children.length; i++) {
    if (removeTab(layout.children[i]!, tabId)) {
      const child = layout.children[i]!;
      if (child.type === "pane" && child.tabIds.length === 0) {
        layout.children.splice(i, 1);
        layout.sizes.splice(i, 1);
        const n = layout.sizes.length;
        if (n > 0) layout.sizes = Array(n).fill(100 / n);
      }
      return true;
    }
  }
  return false;
}

function paneIdentity(pane: PaneNode): string {
  return pane.tabIds[0] ?? "__empty__";
}

function findParentOfPane(node: LayoutNode, paneId: string): SplitNode | undefined {
  if (node.type === "pane") return undefined;
  for (const child of node.children) {
    if (child.type === "pane" && paneIdentity(child) === paneId) return node;
    const found = findParentOfPane(child, paneId);
    if (found !== undefined) return found;
  }
  return undefined;
}

// ─── App component ────────────────────────────────────────

export function App(): React.ReactElement | null {
  const [windowId, setWindowId] = useState(-1);
  const [state, setState] = useState<WindowStateFromMain | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | undefined>(undefined);
  const [dropOverlay, setDropOverlay] = useState(false);

  useEffect(() => {
    if (electron === undefined) { setError("electronAPI not available"); return; }
    setWindowId(electron.getWindowId());
    const init = electron.getInitialState();
    if (init !== undefined) setState(init);
  }, []);

  useEffect(() => { return electron.onStateUpdated(s => setState(s)); }, []);

  useEffect(() => {
    const e = electron.onDragEnter(() => setDropOverlay(true));
    const l = electron.onDragLeave(() => setDropOverlay(false));
    return () => { e(); l(); };
  }, []);

  useEffect(() => {
    if (contextMenu === undefined) return;
    const h = () => setContextMenu(undefined);
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, [contextMenu]);

  const syncLayout = useCallback((layout: LayoutNode, tabs?: Record<string, Tab>) => {
    if (state === undefined) return;
    const t = tabs ?? state.tabs;
    setState({ ...state, layout, tabs: t });
    electron.tabMovedIntra({ windowId, layout });
  }, [state, windowId]);

  const handleTabClick = useCallback((paneId: string, tabId: string) => {
    if (state === undefined) return;
    const layout = cloneLayout(state.layout);
    const p = findPane(layout, tabId);
    if (p === undefined || p.activeTabId === tabId) return;
    p.activeTabId = tabId;
    syncLayout(layout);
  }, [state, syncLayout]);

  const handleCloseTab = useCallback((tabId: string) => {
    if (state === undefined) return;
    const layout = cloneLayout(state.layout);
    removeTab(layout, tabId);
    const tabs = { ...state.tabs };
    delete tabs[tabId];
    syncLayout(layout, tabs);
  }, [state, syncLayout]);

  const handleResize = useCallback((splitPath: number[], sizes: number[]) => {
    if (state === undefined) return;
    const layout = cloneLayout(state.layout);
    let node: LayoutNode = layout;
    for (const idx of splitPath) {
      if (node.type === "pane") return;
      node = node.children[idx]!;
    }
    if (node.type === "split") {
      node.sizes = sizes;
      syncLayout(layout);
    }
  }, [state, syncLayout]);

  const handleTabDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    e.dataTransfer.setData("application/tab-id", tabId);
    e.dataTransfer.effectAllowed = "move";
    const tab = state?.tabs[tabId];
    if (tab !== undefined) {
      electron.tabDragBegin({ windowId, tabId, tabTitle: tab.title, tabColour: tab.colour, tabBounds: { x: 0, y: 0, width: 0, height: 0 } });
    }
  }, [state, windowId]);

  const handleTabDragEnd = useCallback((e: React.DragEvent) => {
    electron.tabDragEnd(e.dataTransfer.dropEffect === "none");
  }, []);

  const handlePaneDrop = useCallback((targetPaneId: string, tabId: string, insertIndex: number) => {
    if (state === undefined) return;
    const sourcePane = findPane(state.layout, tabId);
    if (sourcePane === undefined) return;
    const sourcePaneId = paneIdentity(sourcePane);
    const layout = cloneLayout(state.layout);

    if (sourcePaneId === targetPaneId) {
      // Reorder within same pane
      const p = findPane(layout, tabId);
      if (p === undefined) return;
      const fromIdx = p.tabIds.indexOf(tabId);
      if (fromIdx === -1) return;
      p.tabIds.splice(fromIdx, 1);
      const adjustedIdx = fromIdx < insertIndex ? insertIndex - 1 : insertIndex;
      p.tabIds.splice(adjustedIdx, 0, tabId);
    } else {
      // Move between panes
      removeTab(layout, tabId);
      // Find target pane by identity
      const target = findPaneByIdentity(layout, targetPaneId);
      if (target !== undefined) {
        target.tabIds.splice(insertIndex, 0, tabId);
        target.activeTabId = tabId;
      }
    }
    syncLayout(layout);
  }, [state, syncLayout]);

  const handleOpenTab = useCallback((title: string) => { electron.openTab(title); }, []);
  const handleTogglePin = useCallback((tabId: string) => { electron.toggleTabPin(tabId); }, []);

  const handleSplitPane = useCallback((targetPaneId: string, tabId: string, direction: "row" | "column", side: "before" | "after") => {
    if (state === undefined) return;
    const layout = cloneLayout(state.layout);
    removeTab(layout, tabId);

    // Create a new pane for the dragged tab
    const newPane: PaneNode = {
      type: "pane",
      tabIds: [tabId],
      pinnedTabIds: [],
      activeTabId: tabId,
    };

    // Find the target pane and wrap it in a split
    const parent = findParentOfPane(layout, targetPaneId);
    if (parent === undefined) {
      // Target is the root pane — replace root with a split
      const root = layout as PaneNode;
      const newLayout: SplitNode = {
        type: "split",
        direction,
        sizes: [50, 50],
        children: side === "before" ? [newPane, root] : [root, newPane],
      };
      syncLayout(newLayout);
    } else {
      // Insert into parent's children at the right position
      const targetIdx = parent.children.findIndex(c => {
        if (c.type === "pane") return paneIdentity(c) === targetPaneId;
        return false;
      });
      const insertIdx = side === "before" ? targetIdx : targetIdx + 1;

      if (parent.direction === direction) {
        // Same direction — just insert alongside
        parent.children.splice(insertIdx, 0, newPane);
        parent.sizes.splice(insertIdx, 0, 0);
        // Redistribute
        const n = parent.sizes.length;
        parent.sizes = Array(n).fill(100 / n);
      } else {
        // Different direction — wrap the target pane in a new split
        const targetChild = parent.children[targetIdx]! as PaneNode;
        const innerSplit: SplitNode = {
          type: "split",
          direction,
          sizes: [50, 50],
          children: side === "before" ? [newPane, targetChild] : [targetChild, newPane],
        };
        parent.children[targetIdx] = innerSplit;
      }
      syncLayout(layout);
    }
  }, [state, syncLayout]);

  if (error !== undefined) return <div className="error">{error}</div>;
  if (state === undefined) return <div className="loading">Loading…</div>;

  return (
    <div className="layout-root">
      <SplitOrPane
        node={state.layout}
        tabs={state.tabs}
        splitPath={[]}
        onTabClick={handleTabClick}
        onCloseTab={handleCloseTab}
        onResize={handleResize}
        onTabDragStart={handleTabDragStart}
        onTabDragEnd={handleTabDragEnd}
        onPaneDrop={handlePaneDrop}
        onSplitPane={handleSplitPane}
        onOpenTab={handleOpenTab}
        onContextMenu={(tabId, x, y) => setContextMenu({ tabId, x, y })}
      />
      {dropOverlay && <div className="drop-overlay" />}
      {contextMenu !== undefined && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
          <button className="context-item" onClick={() => { electron.toggleTabPin(contextMenu.tabId); setContextMenu(undefined); }}>
            {state.tabs[contextMenu.tabId]?.pinned ? "Unpin" : "Pin"}
          </button>
          <button className="context-item" onClick={() => { handleCloseTab(contextMenu.tabId); setContextMenu(undefined); }}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Shared callback interface ────────────────────────────

interface Callbacks {
  onTabClick: (paneId: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onResize: (splitPath: number[], sizes: number[]) => void;
  onTabDragStart: (e: React.DragEvent, tabId: string) => void;
  onTabDragEnd: (e: React.DragEvent) => void;
  onPaneDrop: (targetPaneId: string, tabId: string, insertIndex: number) => void;
  onSplitPane: (targetPaneId: string, tabId: string, direction: "row" | "column", side: "before" | "after") => void;
  onOpenTab: (title: string) => void;
  onContextMenu: (tabId: string, x: number, y: number) => void;
}

// ─── Recursive layout ─────────────────────────────────────

function SplitOrPane(props: {
  node: LayoutNode;
  tabs: Record<string, Tab>;
  splitPath: number[];
} & Callbacks): React.ReactElement {
  if (props.node.type === "pane") return <Pane {...props} pane={props.node} />;
  return <Split {...props} split={props.node} />;
}

// ─── Split ────────────────────────────────────────────────

function Split(props: {
  split: SplitNode;
  tabs: Record<string, Tab>;
  splitPath: number[];
} & Callbacks): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragIdx, setDragIdx] = useState(-1);
  const sizesRef = useRef([...props.split.sizes]);

  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    setDragIdx(index);
    sizesRef.current = [...props.split.sizes];
    const startPos = props.split.direction === "row" ? e.clientX : e.clientY;

    const onMove = (ev: MouseEvent) => {
      const container = containerRef.current;
      if (container === null) return;
      const rect = container.getBoundingClientRect();
      const totalPx = props.split.direction === "row" ? rect.width : rect.height;
      const deltaPx = (props.split.direction === "row" ? ev.clientX : ev.clientY) - startPos;
      const deltaPct = (deltaPx / totalPx) * 100;

      const sizes = [...sizesRef.current];
      const left = sizes[index]! + deltaPct;
      const right = sizes[index + 1]! - deltaPct;
      if (left < 5 || right < 5) return;
      sizes[index] = left;
      sizes[index + 1] = right;
      // Re-normalise
      const sum = sizes.reduce((a, b) => a + b, 0);
      sizesRef.current = sizes.map(s => (s / sum) * 100);
      setDragIdx(index); // trigger re-render
    };

    const onUp = () => {
      props.onResize(props.splitPath, sizesRef.current);
      setDragIdx(-1);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [props]);

  const dir = props.split.direction === "row" ? "row" : "column";
  const currentSizes = dragIdx >= 0 ? sizesRef.current : props.split.sizes;

  return (
    <div ref={containerRef} className={`split split-${dir}`}>
      {props.split.children.map((child, i) => (
        <React.Fragment key={i}>
          <div className="split-child" style={{ flexBasis: `${currentSizes[i]}%` }}>
            <SplitOrPane
              node={child}
              tabs={props.tabs}
              splitPath={[...props.splitPath, i]}
              onTabClick={props.onTabClick}
              onCloseTab={props.onCloseTab}
              onResize={props.onResize}
              onTabDragStart={props.onTabDragStart}
              onTabDragEnd={props.onTabDragEnd}
              onPaneDrop={props.onPaneDrop}
              onSplitPane={props.onSplitPane}
              onOpenTab={props.onOpenTab}
              onContextMenu={props.onContextMenu}
            />
          </div>
          {i < props.split.children.length - 1 && (
            <div className={`resize-handle resize-${dir}`} onMouseDown={e => handleMouseDown(i, e)} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Pane (tab bar + content) ─────────────────────────────

function findPaneByIdentity(node: LayoutNode, paneId: string): PaneNode | undefined {
  if (node.type === "pane") return paneIdentity(node) === paneId ? node : undefined;
  for (const c of node.children) { const f = findPaneByIdentity(c, paneId); if (f) return f; }
  return undefined;
}

const NEW_TITLES = ["new-file.ts", "untitled.txt", "scratch.md", "notes.json", "config.yaml", "test.spec.ts"];

function Pane(props: {
  pane: PaneNode;
  tabs: Record<string, Tab>;
} & Callbacks): React.ReactElement {
  const { pane, tabs } = props;
  const pid = paneIdentity(pane);
  const insertRef = useRef(-1);
  const [dragOver, setDragOver] = useState(false);
  const [insertIdx, setInsertIdx] = useState(-1);
  const [splitZone, setSplitZone] = useState<"left" | "right" | "top" | "bottom" | null>(null);


  const EDGE = 0.25; // 25% edge zone for split detection

  const computeSplitZone = (el: HTMLElement, clientX: number, clientY: number): "left" | "right" | "top" | "bottom" | null => {
    const rect = el.getBoundingClientRect();
    const rx = (clientX - rect.left) / rect.width;
    const ry = (clientY - rect.top) / rect.height;
    // Pick whichever edge is closest
    const dists = [
      { zone: "left" as const, d: rx },
      { zone: "right" as const, d: 1 - rx },
      { zone: "top" as const, d: ry },
      { zone: "bottom" as const, d: 1 - ry },
    ];
    const closest = dists.reduce((a, b) => a.d < b.d ? a : b);
    return closest.d < EDGE ? closest.zone : null;
  };

  const computeInsertIndex = (barEl: HTMLElement, clientX: number): number => {
    const buttons = barEl.querySelectorAll(".tab-button");
    const barRect = barEl.getBoundingClientRect();
    const x = clientX - barRect.left;
    for (let i = 0; i < buttons.length; i++) {
      const btnRect = buttons[i]!.getBoundingClientRect();
      if (x < btnRect.left - barRect.left + btnRect.width / 2) return i;
    }
    return buttons.length;
  };

  return (
    <div className="pane">
      <div
        className={`tab-bar${dragOver ? " drag-over" : ""}`}
        onDragOver={e => {
          if (!e.dataTransfer.types.includes("application/tab-id")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const idx = computeInsertIndex(e.currentTarget, e.clientX);
          insertRef.current = idx;
          setDragOver(true);
          setInsertIdx(idx);
          setSplitZone(null);
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOver(false);
            setInsertIdx(-1);
          }
        }}
        onDrop={e => {
          setDragOver(false);
          setInsertIdx(-1);
          const tabId = e.dataTransfer.getData("application/tab-id");
          if (tabId === "") return;
          e.preventDefault();
          props.onPaneDrop(pid, tabId, insertRef.current >= 0 ? insertRef.current : pane.tabIds.length);
          insertRef.current = -1;
        }}
      >
        {pane.tabIds.map((tabId, i) => {
          const tab = tabs[tabId];
          const active = tabId === pane.activeTabId;
          return (
            <React.Fragment key={tabId}>
              {dragOver && insertIdx === i && <div className="tab-insert-indicator" />}
              <button
                className={`tab-button${active ? " active" : ""}${tab?.pinned ? " pinned" : ""}`}
                draggable
                onClick={() => props.onTabClick(pid, tabId)}
                onDragStart={e => props.onTabDragStart(e, tabId)}
                onDragEnd={e => props.onTabDragEnd(e)}
                onContextMenu={e => { e.preventDefault(); props.onContextMenu(tabId, e.clientX, e.clientY); }}
                onAuxClick={e => { if (e.button === 1) { e.preventDefault(); props.onCloseTab(tabId); } }}
              >
                <span className="tab-dot" style={{ background: tab?.colour ?? "#888" }} />
                <span className="tab-title">{tab?.title ?? tabId}</span>
                {tab?.pinned && <span className="tab-badge">📌</span>}
                {tab?.preview && <span className="tab-badge preview">preview</span>}
                {tab?.dirty && <span className="tab-badge dirty">●</span>}
                <span className="tab-close" onClick={e => { e.stopPropagation(); props.onCloseTab(tabId); }}>
                  {tab?.dirty ? "●" : "×"}
                </span>
              </button>
            </React.Fragment>
          );
        })}
        {dragOver && insertIdx >= pane.tabIds.length && <div className="tab-insert-indicator" />}
        <button className="tab-add" onClick={() => props.onOpenTab(NEW_TITLES[Math.floor(Math.random() * NEW_TITLES.length)])}>+</button>
      </div>
      <div
        className="pane-content"
        onDragOver={e => {
          if (!e.dataTransfer.types.includes("application/tab-id")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOver(false);
          setInsertIdx(-1);
          setSplitZone(computeSplitZone(e.currentTarget, e.clientX, e.clientY));
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setSplitZone(null);
          }
        }}
        onDrop={e => {
          const tabId = e.dataTransfer.getData("application/tab-id");
          if (tabId === "") return;
          e.preventDefault();
          e.stopPropagation();
          const zone = computeSplitZone(e.currentTarget, e.clientX, e.clientY);
          setSplitZone(null);
          if (zone === null) return; // centre — no-op
          const dirMap: Record<string, ["row" | "column", "before" | "after"]> = {
            left: ["row", "before"],
            right: ["row", "after"],
            top: ["column", "before"],
            bottom: ["column", "after"],
          };
          const [direction, side] = dirMap[zone]!;
          props.onSplitPane(pid, tabId, direction, side);
        }}
      >
        {splitZone !== null && (
          <div className={`split-zone-overlay split-zone-${splitZone}`} />
        )}
        <ContentArea tab={tabs[pane.activeTabId]} tabId={pane.activeTabId} />
      </div>
    </div>
  );
}

function ContentArea({ tab, tabId }: { tab: Tab | undefined; tabId: string }): React.ReactElement {
  if (tab === undefined) return <div className="content-empty">No tab open</div>;
  return (
    <div className="content-header">
      <span className="content-dot" style={{ backgroundColor: tab.colour }} />
      <span className="content-title">{tab.title}</span>
      {tab.pinned && <span className="content-badge pinned">pinned</span>}
      {tab.preview && <span className="content-badge preview">preview</span>}
      {tab.dirty && <span className="content-badge dirty">modified</span>}
      <button className="content-action" onClick={() => electron.toggleTabDirty(tabId)}>
        {tab.dirty ? "Save" : "Edit"}
      </button>
    </div>
  );
}
