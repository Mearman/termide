import { useState, useEffect, useRef, useCallback } from "react";
import type { PaneNode, Tab } from "../types.ts";

interface PaneProps {
  pane: PaneNode;
  tabs: Record<string, Tab>;
  windowId: number;
  path: string;
  onSetActiveTab: (tabId: string) => void;
}

export function Pane({
  pane,
  tabs,
  windowId,
  path,
  onSetActiveTab,
}: PaneProps): React.ReactElement {
  const [draggingTabId, setDraggingTabId] = useState<string | undefined>(undefined);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  // Listen for external (cross-window) drag enter/leave
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

  const handleTabDragStart = useCallback(
    (e: React.DragEvent, tabId: string) => {
      setDraggingTabId(tabId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tabId);

      // Get the tab element's position relative to the screen
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const winBounds = { x: window.screenX, y: window.screenY };

      window.electronAPI.dragTabStart({
        windowId,
        tabId,
        tabBounds: {
          x: winBounds.x + rect.left,
          y: winBounds.y + rect.top,
          width: rect.width,
          height: rect.height,
        },
      });
    },
    [windowId],
  );

  const handleTabDragEnd = useCallback(
    (e: React.DragEvent) => {
      setDraggingTabId(undefined);

      // If the drop happened outside this window, the main process handles it.
      // completed = true means "the user released the mouse while dragging".
      // The main process will decide if it was on another window or empty space.
      const dropEffect = e.dataTransfer.dropEffect;
      if (dropEffect === "none") {
        // Drag ended without a valid in-window drop — might be cross-window
        window.electronAPI.dragTabEnd(true);
      } else {
        window.electronAPI.dragTabEnd(false);
      }
    },
    [],
  );

  const handleDropOnTabBar = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsExternalDragOver(false);
      // Cross-window drops are handled by the main process pushing new state.
      // Intra-window drops are handled by react-mosaic's built-in DnD.
    },
    [],
  );

  const activeTab = pane.activeTabId !== ""
    ? tabs[pane.activeTabId]
    : undefined;

  if (pane.tabIds.length === 0) {
    return <div className="empty-pane">No tabs open</div>;
  }

  return (
    <div
      ref={paneRef}
      className={`pane${isExternalDragOver ? " drag-over" : ""}`}
    >
      <div
        className={`tab-bar${isExternalDragOver ? " drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={handleDropOnTabBar}
      >
        {pane.tabIds.map((tabId) => {
          const tab = tabs[tabId];
          if (tab === undefined) return null;
          const isActive = tabId === pane.activeTabId;
          const isDragging = tabId === draggingTabId;

          return (
            <div
              key={tabId}
              className={`tab${isActive ? " active" : ""}${isDragging ? " dragging" : ""}`}
              draggable
              onDragStart={(e) => handleTabDragStart(e, tabId)}
              onDragEnd={handleTabDragEnd}
              onClick={() => onSetActiveTab(tabId)}
            >
              <span className="tab-colour" style={{ background: tab.colour }} />
              <span>{tab.title}</span>
              <span className="tab-close">×</span>
            </div>
          );
        })}
        <div className="tab-bar-drop-zone" />
      </div>
      {activeTab !== undefined ? (
        <div className="tab-content">
          <span style={{ color: activeTab.colour }}>●</span>{" "}
          {activeTab.title}
        </div>
      ) : (
        <div className="tab-content">Select a tab</div>
      )}
    </div>
  );
}
