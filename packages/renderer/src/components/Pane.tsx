import { useState, useEffect, useCallback } from "react";
import type { PaneNode, Tab } from "../types.ts";

/** Data stored in dataTransfer during an intra-window tab drag. */
interface TabDragData {
  tabId: string;
  sourcePanePath: string;
}

interface PaneProps {
  pane: PaneNode;
  tabs: Record<string, Tab>;
  windowId: number;
  path: string;
  onSetActiveTab: (tabId: string) => void;
  /** Called when a tab from THIS pane is dropped on another pane within the same window. */
  onMoveTabBetweenPanes: (tabId: string, fromPath: string, toPath: string, insertBeforeTabId?: string) => void;
}

export function Pane({
  pane,
  tabs,
  windowId,
  path,
  onSetActiveTab,
  onMoveTabBetweenPanes,
}: PaneProps): React.ReactElement {
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);

  // Listen for cross-window drag enter/leave (main process pushes these)
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
    (e: React.DragEvent, tabId: string) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/tab-drag", JSON.stringify({
        tabId,
        sourcePanePath: path,
      } satisfies TabDragData));

      // Also notify main process so it can track cursor for potential cross-window
      const tab = tabs[tabId];
      if (tab === undefined) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      window.electronAPI.tabDragBegin({
        windowId,
        tabId,
        tabTitle: tab.title,
        tabColour: tab.colour,
        tabBounds: {
          x: window.screenX + rect.left,
          y: window.screenY + rect.top,
          width: rect.width,
          height: rect.height,
        },
      });
    },
    [windowId, path, tabs],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent) => {
      // If the drop happened within this window, HTML5 DnD handled it.
      // If dropEffect is "none", the drag ended outside this window —
      // tell the main process to handle cross-window completion.
      if (e.dataTransfer.dropEffect === "none") {
        window.electronAPI.tabDragEnd(true);
      } else {
        window.electronAPI.tabDragEnd(false);
      }
    },
    [],
  );

  const handleTabBarDragOver = useCallback((e: React.DragEvent) => {
    // Only accept our custom tab-drag mime type
    if (e.dataTransfer.types.includes("application/tab-drag")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, []);

  const handleTabBarDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/tab-drag");
      if (raw === "") return;

      const dragData: TabDragData = JSON.parse(raw);

      // Find which tab we're dropping before (if any)
      const targetTab = (e.target as HTMLElement).closest("[data-testid='tab']");
      const insertBeforeTabId: string | undefined =
        targetTab !== null ? (targetTab as HTMLElement).dataset.tabId : undefined;

      onMoveTabBetweenPanes(
        dragData.tabId,
        dragData.sourcePanePath,
        path,
        insertBeforeTabId,
      );
    },
    [path, onMoveTabBetweenPanes],
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
    >
      <div
        data-testid="tab-bar"
        className={`tab-bar${isExternalDragOver ? " drag-over" : ""}`}
        onDragOver={handleTabBarDragOver}
        onDrop={handleTabBarDrop}
      >
        {pane.tabIds.map((tabId) => {
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
              onDragStart={(e) => handleDragStart(e, tabId)}
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
    </div>
  );
}
