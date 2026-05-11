import { useState, useEffect, useCallback } from "react";
import type { PaneNode, Tab } from "../types.ts";

/** Data stored in dataTransfer during an intra-window tab drag. */
interface TabDragData {
  tabId: string;
  sourcePanePath: string;
  sourceIndex: number;
}

interface PaneProps {
  pane: PaneNode;
  tabs: Record<string, Tab>;
  windowId: number;
  path: string;
  onSetActiveTab: (tabId: string) => void;
  onReorderTabs: (tabId: string, fromIndex: number, toIndex: number) => void;
  onMoveTabBetweenPanes: (tabId: string, fromPath: string, toPath: string, insertBeforeTabId?: string) => void;
  onSplitPane: (tabId: string, sourcePanePath: string, direction: "row" | "column") => void;
}

export function Pane({
  pane,
  tabs,
  windowId,
  path,
  onSetActiveTab,
  onReorderTabs,
  onMoveTabBetweenPanes,
  onSplitPane,
}: PaneProps): React.ReactElement {
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [isLocalDragOver, setIsLocalDragOver] = useState(false);

  // Listen for cross-window drag enter/leave
  useEffect(() => {
    const unsubEnter = window.electronAPI.onDragEnter(() => {
      setIsExternalDragOver(true);
    });
    const unsubLeave = window.electronAPI.onDragLeave(() => {
      setIsExternalDragOver(false);
    });
    return () => {
      unsubEnter();
      unsubLeave();
    };
  }, []);

  // ─── Intra-window HTML5 DnD ────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent, tabId: string, index: number) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/tab-drag", JSON.stringify({
        tabId,
        sourcePanePath: path,
        sourceIndex: index,
      } satisfies TabDragData));

      // Store drag info for potential cross-window handoff.
      // We do NOT notify the main process yet — only when the drag leaves
      // the window (detected via document dragleave) do we hand off.
    },
    [path],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent) => {
      setIsLocalDragOver(false);
      // If the drop happened outside this window, the main process handles it.
      // Otherwise intra-window HTML5 DnD already handled it.
      if (e.dataTransfer.dropEffect === "none") {
        // Drag ended outside — cross-window path
        // TODO: notify main process for cross-window handling
      }
    },
    [],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/tab-drag")) {
      setIsLocalDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only unset if we're truly leaving the pane, not entering a child
    const related = e.relatedTarget as HTMLElement | null;
    if (related !== null && e.currentTarget.contains(related)) return;
    setIsLocalDragOver(false);
  }, []);

  // ─── Tab bar drop: reorder or move between panes ────────

  const handleTabBarDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/tab-drag")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, []);

  const handleTabBarDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsLocalDragOver(false);
      const raw = e.dataTransfer.getData("application/tab-drag");
      if (raw === "") return;

      const dragData: TabDragData = JSON.parse(raw);

      if (dragData.sourcePanePath === path) {
        // Same pane — reorder
        const targetTab = (e.target as HTMLElement).closest("[data-tab-id]");
        const targetTabId: string | undefined =
          targetTab !== null ? (targetTab as HTMLElement).dataset.tabId : undefined;

        if (targetTabId !== undefined && targetTabId !== dragData.tabId) {
          const toIndex = pane.tabIds.indexOf(targetTabId);
          if (toIndex !== -1) {
            onReorderTabs(dragData.tabId, dragData.sourceIndex, toIndex);
          }
        }
      } else {
        // Different pane — move
        const targetTab = (e.target as HTMLElement).closest("[data-tab-id]");
        const insertBeforeTabId: string | undefined =
          targetTab !== null ? (targetTab as HTMLElement).dataset.tabId : undefined;

        onMoveTabBetweenPanes(
          dragData.tabId,
          dragData.sourcePanePath,
          path,
          insertBeforeTabId,
        );
      }
    },
    [path, pane.tabIds, onReorderTabs, onMoveTabBetweenPanes],
  );

  // ─── Split zone drops ──────────────────────────────────

  const handleSplitZoneDrop = useCallback(
    (e: React.DragEvent, direction: "row" | "column") => {
      e.preventDefault();
      e.stopPropagation();
      setIsLocalDragOver(false);

      const raw = e.dataTransfer.getData("application/tab-drag");
      if (raw === "") return;

      const dragData: TabDragData = JSON.parse(raw);
      // Always split — if from a different pane, the split handler in App
      // will first move the tab, then split it.
      onSplitPane(dragData.tabId, dragData.sourcePanePath, direction);
    },
    [onSplitPane],
  );

  // ─── Render ────────────────────────────────────────────

  const activeTab = pane.activeTabId !== ""
    ? tabs[pane.activeTabId]
    : undefined;

  if (pane.tabIds.length === 0) {
    return (
      <div
        data-testid="pane"
        data-pane-path={path}
        className="empty-pane"
        onDragOver={handleTabBarDragOver}
        onDrop={handleTabBarDrop}
      >
        No tabs open
      </div>
    );
  }

  return (
    <div
      data-testid="pane"
      data-pane-path={path}
      className={`pane${isExternalDragOver ? " drag-over" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      <div
        data-testid="tab-bar"
        className="tab-bar"
        onDragOver={handleTabBarDragOver}
        onDrop={handleTabBarDrop}
      >
        {pane.tabIds.map((tabId, index) => {
          const tab = tabs[tabId];
          if (tab === undefined) return null;
          const isActive = tabId === pane.activeTabId;

          return (
            <div
              key={tabId}
              data-testid="tab"
              data-tab-id={tabId}
              className={`tab${isActive ? " active" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, tabId, index)}
              onDragEnd={handleDragEnd}
              onClick={() => onSetActiveTab(tabId)}
            >
              <span className="tab-colour" style={{ background: tab.colour }} />
              <span>{tab.title}</span>
              <span className="tab-close">×</span>
            </div>
          );
        })}
      </div>
      {activeTab !== undefined ? (
        <div className="tab-content" data-testid="tab-content">
          <span style={{ color: activeTab.colour }}>●</span>{" "}
          {activeTab.title}
        </div>
      ) : (
        <div className="tab-content">Select a tab</div>
      )}

      {/* Split zones — visible when dragging a tab from a DIFFERENT pane over this pane */}
      {isLocalDragOver && pane.tabIds.length > 0 && (
        <>
          <div
            data-testid="split-zone-right"
            className="split-zone split-zone-right"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; }}
            onDrop={(e) => handleSplitZoneDrop(e, "row")}
          />
          <div
            data-testid="split-zone-bottom"
            className="split-zone split-zone-bottom"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; }}
            onDrop={(e) => handleSplitZoneDrop(e, "column")}
          />
        </>
      )}
    </div>
  );
}
