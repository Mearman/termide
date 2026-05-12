import React, { useState, useEffect, useCallback, useRef } from "react";
import type { PaneNode, Tab } from "../types.ts";

/** Data stored in dataTransfer during an intra-window tab drag. */
interface TabDragData {
  tabId: string;
  sourcePanePath: string;
  sourceIndex: number;
}

/** Computed drop zone during content-area drag. */
type DropZone =
  | { type: "merge" }
  | { type: "split"; direction: "row" | "column"; side: "left" | "right" | "top" | "bottom" };

/** Edge threshold as a fraction of the content area dimension. */
const EDGE_THRESHOLD = 0.1;

/** How long to hover a tab during drag before auto-activating it. */
const AUTO_ACTIVATE_DELAY = 1500;

interface PaneProps {
  pane: PaneNode;
  tabs: Record<string, Tab>;
  windowId: number;
  path: string;
  onSetActiveTab: (tabId: string) => void;
  onReorderTabs: (tabId: string, fromIndex: number, toIndex: number) => void;
  onMoveTabBetweenPanes: (tabId: string, fromPath: string, toPath: string, insertBeforeTabId?: string) => void;
  onCopyTabToPane: (tabId: string, toPath: string, insertBeforeTabId?: string) => void;
  onSplitPane: (tabId: string, sourcePanePath: string, direction: "row" | "column") => void;
  onCloseTab: (tabId: string) => void;
  onTogglePin: (tabId: string) => void;
}

export function Pane({
  pane,
  tabs,
  windowId,
  path,
  onSetActiveTab,
  onReorderTabs,
  onMoveTabBetweenPanes,
  onCopyTabToPane,
  onSplitPane,
  onCloseTab,
  onTogglePin,
}: PaneProps): React.ReactElement {
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [isLocalDragOver, setIsLocalDragOver] = useState(false);

  // Tab bar insertion indicator: which tab is the drop target and on which side
  const [insertIndicator, setInsertIndicator] = useState<{ tabId: string; side: "left" | "right" } | undefined>(undefined);

  // Content area drop overlay zone
  const [dropZone, setDropZone] = useState<DropZone | undefined>(undefined);

  // Auto-activate timer for drag-over
  const autoActivateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoActivateTarget = useRef<string | undefined>(undefined);

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

  // Broadcast drag target state to main process for cross-window coordination.
  // When a tab drag is active and the cursor enters this pane, report it
  // as a potential drop target. When it leaves, clear it.
  const handlePaneDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("application/tab-drag")) {
        setIsLocalDragOver(true);
        // Report to main process that this window is a potential drop target
        window.electronAPI.dragTargetEnter(windowId);
      }
    },
    [windowId],
  );

  const handlePaneDragLeave = useCallback(
    (e: React.DragEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (related !== null && e.currentTarget.contains(related)) return;
      setIsLocalDragOver(false);
      setInsertIndicator(undefined);
      setDropZone(undefined);
      window.electronAPI.dragTargetLeave(windowId);
    },
    [windowId],
  );

  // Clean up auto-activate timer on unmount
  useEffect(() => {
    return () => {
      if (autoActivateTimer.current !== undefined) clearTimeout(autoActivateTimer.current);
    };
  }, []);

  // ─── Intra-window HTML5 DnD ────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent, tabId: string, index: number) => {
      e.dataTransfer.effectAllowed = "copyMove";
      e.dataTransfer.setData("application/tab-drag", JSON.stringify({
        tabId,
        sourcePanePath: path,
        sourceIndex: index,
      } satisfies TabDragData));

      // Notify main process that a cross-window drag MAY happen.
      const tab = tabs[tabId];
      if (tab !== undefined) {
        window.electronAPI.tabDragBegin({
          windowId,
          tabId,
          tabTitle: tab.title,
          tabColour: tab.colour,
          tabBounds: { x: 0, y: 0, width: 0, height: 0 },
        });
      }
    },
    [path, windowId, tabs],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent) => {
      setIsLocalDragOver(false);
      setInsertIndicator(undefined);
      setDropZone(undefined);
      if (autoActivateTimer.current !== undefined) {
        clearTimeout(autoActivateTimer.current);
        autoActivateTimer.current = undefined;
      }
      const completed = e.dataTransfer.dropEffect === "none";
      window.electronAPI.tabDragEnd(completed);
    },
    [],
  );

  // ─── Tab bar drop: insertion indicators + reorder/move ──

  const handleTabBarDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/tab-drag")) return;
      e.preventDefault();

      // Check modifier keys for copy vs move
      const isCopy = e.altKey || (e.ctrlKey && navigator.platform !== "MacIntel");
      e.dataTransfer.dropEffect = isCopy ? "copy" : "move";

      // Compute insertion indicator
      const tabEl = (e.target as HTMLElement).closest("[data-tab-id]");
      if (tabEl !== null) {
        const tabId = (tabEl as HTMLElement).dataset.tabId;
        const rect = tabEl.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const side = e.clientX < midX ? "left" : "right";
        if (tabId !== undefined) {
          setInsertIndicator({ tabId, side });
        }
      }
    },
    [],
  );

  const handleTabBarDragLeave = useCallback(() => {
    setInsertIndicator(undefined);
  }, []);

  const handleTabBarDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsLocalDragOver(false);
      setInsertIndicator(undefined);
      const raw = e.dataTransfer.getData("application/tab-drag");
      if (raw === "") return;

      const dragData: TabDragData = JSON.parse(raw);
      const isCopy = e.dataTransfer.dropEffect === "copy";

      if (dragData.sourcePanePath === path) {
        // Same pane — reorder (copy is meaningless within same pane)
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
        // Different pane — move or copy
        const targetTab = (e.target as HTMLElement).closest("[data-tab-id]");
        const insertBeforeTabId: string | undefined =
          targetTab !== null ? (targetTab as HTMLElement).dataset.tabId : undefined;

        if (isCopy) {
          onCopyTabToPane(dragData.tabId, path, insertBeforeTabId);
        } else {
          onMoveTabBetweenPanes(
            dragData.tabId,
            dragData.sourcePanePath,
            path,
            insertBeforeTabId,
          );
        }
      }
    },
    [path, pane.tabIds, onReorderTabs, onMoveTabBetweenPanes, onCopyTabToPane],
  );

  // ─── Content area drop overlay ─────────────────────────

  const contentRef = useRef<HTMLDivElement>(null);

  const computeDropZone = useCallback(
    (e: React.DragEvent): DropZone => {
      const el = contentRef.current;
      if (el === null) return { type: "merge" };

      const rect = el.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;

      // Edge detection
      if (relX < EDGE_THRESHOLD) return { type: "split", direction: "row", side: "left" };
      if (relX > 1 - EDGE_THRESHOLD) return { type: "split", direction: "row", side: "right" };
      if (relY < EDGE_THRESHOLD) return { type: "split", direction: "column", side: "top" };
      if (relY > 1 - EDGE_THRESHOLD) return { type: "split", direction: "column", side: "bottom" };

      return { type: "merge" };
    },
    [],
  );

  const handleContentDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/tab-drag")) return;
      e.preventDefault();
      e.stopPropagation();

      const isCopy = e.altKey || (e.ctrlKey && navigator.platform !== "MacIntel");
      e.dataTransfer.dropEffect = isCopy ? "copy" : "move";

      const zone = computeDropZone(e);
      setDropZone(zone);

      // Auto-activate on hover timeout
      // (only applies when merging — hovering over content area)
      if (zone.type === "merge") {
        if (autoActivateTarget.current !== pane.activeTabId) {
          if (autoActivateTimer.current !== undefined) clearTimeout(autoActivateTimer.current);
          autoActivateTarget.current = pane.activeTabId;
          autoActivateTimer.current = setTimeout(() => {
            // Already on the active tab, no activation needed
          }, AUTO_ACTIVATE_DELAY);
        }
      }
    },
    [computeDropZone, pane.activeTabId],
  );

  const handleContentDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsLocalDragOver(false);
      setDropZone(undefined);

      const raw = e.dataTransfer.getData("application/tab-drag");
      if (raw === "") return;

      const dragData: TabDragData = JSON.parse(raw);
      const zone = computeDropZone(e);

      if (zone.type === "split") {
        onSplitPane(dragData.tabId, dragData.sourcePanePath, zone.direction);
      } else {
        // Merge: move tab to this pane
        if (dragData.sourcePanePath !== path) {
          onMoveTabBetweenPanes(dragData.tabId, dragData.sourcePanePath, path);
        }
      }
    },
    [computeDropZone, onSplitPane, onMoveTabBetweenPanes, path],
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
        Drop tabs here
      </div>
    );
  }

  return (
    <div
      data-testid="pane"
      data-pane-path={path}
      className={`pane${isExternalDragOver ? " drag-over" : ""}`}
      onDragEnter={handlePaneDragEnter}
      onDragLeave={handlePaneDragLeave}
    >
      {/* Tab bar */}
      <div
        data-testid="tab-bar"
        className="tab-bar"
        onDragOver={handleTabBarDragOver}
        onDragLeave={handleTabBarDragLeave}
        onDrop={handleTabBarDrop}
      >
        {pane.tabIds.map((tabId, index) => {
          const tab = tabs[tabId];
          if (tab === undefined) return null;
          const isActive = tabId === pane.activeTabId;
          const isPinned = pane.pinnedTabIds.includes(tabId);
          const showLeftIndicator = insertIndicator?.tabId === tabId && insertIndicator.side === "left";
          const showRightIndicator = insertIndicator?.tabId === tabId && insertIndicator.side === "right";

          // Show separator between last pinned tab and first unpinned tab
          const isLastPinned = isPinned && index === pane.pinnedTabIds.length - 1;
          const hasUnpinned = pane.tabIds.length > pane.pinnedTabIds.length;

          return (
            <React.Fragment key={tabId}>
              <div
                data-testid="tab"
                data-tab-id={tabId}
                className={`tab${isActive ? " active" : ""}${isPinned ? " pinned" : ""}${tab.preview ? " preview" : ""}${tab.dirty ? " dirty" : ""}`}
                draggable
                onDragStart={(e) => handleDragStart(e, tabId, index)}
                onDragEnd={handleDragEnd}
                onClick={() => onSetActiveTab(tabId)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (tab.preview) {
                    // Pin the preview tab on double-click
                    onTogglePin(tabId);
                  } else {
                    // Toggle pinned state
                    onTogglePin(tabId);
                  }
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onCloseTab(tabId);
                  }
                }}
              >
                {showLeftIndicator && <span className="tab-insert-indicator left" />}
                <span className="tab-colour" style={{ background: tab.colour }} />
                {isPinned ? (
                  <span className="tab-pin-icon" title={tab.title}>📌</span>
                ) : (
                  <span className="tab-label">{tab.title}</span>
                )}
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tabId);
                  }}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    // Right-click toggle dirty for demo
                    window.electronAPI.toggleTabDirty(tabId);
                  }}
                >
                  {tab.dirty ? "●" : "×"}
                </span>
                {showRightIndicator && <span className="tab-insert-indicator right" />}
              </div>
              {isLastPinned && hasUnpinned && <div className="tab-separator" />}
            </React.Fragment>
          );
        })}
        {/* New tab button */}
        <button
          className="tab-new-button"
          onClick={() => {
            const titles = [
              "new-file.ts",
              "untitled.txt",
              "scratch.md",
              "notes.json",
              "config.yaml",
              "test.spec.ts",
              "helper.ts",
              "utils.ts",
              "README.md",
            ];
            const title = titles[Math.floor(Math.random() * titles.length)];
            window.electronAPI.openTab(title);
          }}
        >
          +
        </button>
      </div>

      {/* Content area with drop overlay */}
      <div
        ref={contentRef}
        className="tab-content"
        data-testid="tab-content"
        onDragOver={handleContentDragOver}
        onDrop={handleContentDrop}
      >
        {activeTab !== undefined ? (
          <>
            <span style={{ color: activeTab.colour }}>●</span>{" "}
            {activeTab.title}
          </>
        ) : (
          "Select a tab"
        )}

        {/* Drop overlay — visible during cross-pane drag over content */}
        {isLocalDragOver && dropZone !== undefined && (
          <div className={`drop-overlay ${dropZone.type === "merge" ? "drop-overlay-merge" : `drop-overlay-split-${dropZone.side}`}`} />
        )}
      </div>

      {/* Legacy split zones for backward-compatible test IDs */}
      {/* These map to the content-area overlay zones */}
      {isLocalDragOver && (
        <>
          <div
            data-testid="split-zone-right"
            className="split-zone split-zone-right"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsLocalDragOver(false);
              const raw = e.dataTransfer.getData("application/tab-drag");
              if (raw === "") return;
              const dragData: TabDragData = JSON.parse(raw);
              onSplitPane(dragData.tabId, dragData.sourcePanePath, "row");
            }}
          />
          <div
            data-testid="split-zone-bottom"
            className="split-zone split-zone-bottom"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsLocalDragOver(false);
              const raw = e.dataTransfer.getData("application/tab-drag");
              if (raw === "") return;
              const dragData: TabDragData = JSON.parse(raw);
              onSplitPane(dragData.tabId, dragData.sourcePanePath, "column");
            }}
          />
        </>
      )}
    </div>
  );
}
