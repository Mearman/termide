import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowStateFromMain, LayoutNode, Tab, PaneNode } from "./types.ts";
import { Pane } from "./components/Pane.tsx";

const electron = window.electronAPI;

export function App(): React.ReactElement | null {
  const [windowId, setWindowId] = useState<number>(-1);
  const [state, setState] = useState<WindowStateFromMain | undefined>(undefined);

  useEffect(() => {
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

  const handleLayoutChange = useCallback(
    (newLayout: LayoutNode) => {
      if (state === undefined) return;
      const updated = { ...state, layout: newLayout };
      setState(updated);
      electron.tabMovedIntra({ windowId, layout: newLayout });
    },
    [state, windowId],
  );

  if (state === undefined) {
    return <div style={{ padding: 20, color: "#a6adc8" }}>Loading…</div>;
  }

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <LayoutRenderer
        node={state.layout}
        tabs={state.tabs}
        windowId={windowId}
        onLayoutChange={handleLayoutChange}
        onSetActiveTab={(panePath: string, tabId: string) => {
          if (state === undefined) return;
          const newLayout = setActiveTabInTree(state.layout, panePath, tabId);
          const updated = { ...state, layout: newLayout };
          setState(updated);
          electron.tabMovedIntra({ windowId, layout: newLayout });
        }}
      />
    </div>
  );
}

/**
 * Recursively renders the layout tree.
 * This is a simplified split-pane layout (not using react-mosaic yet)
 * to demonstrate the cross-window drag coordination.
 */
interface LayoutRendererProps {
  node: LayoutNode;
  tabs: Record<string, Tab>;
  windowId: number;
  onLayoutChange: (layout: LayoutNode) => void;
  onSetActiveTab: (panePath: string, tabId: string) => void;
  path?: string;
}

function LayoutRenderer({
  node,
  tabs,
  windowId,
  onLayoutChange,
  onSetActiveTab,
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
      />
    );
  }

  // SplitNode
  const dir = node.direction === "row" ? "flex-row" : "flex-column";
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
            onLayoutChange={onLayoutChange}
            onSetActiveTab={onSetActiveTab}
            path={`${path}.${i}`}
          />
        </div>
      ))}
    </div>
  );
}

function setActiveTabInTree(
  node: LayoutNode,
  path: string,
  tabId: string,
): LayoutNode {
  if (node.type === "pane") {
    if (path.endsWith("root") || path.includes(".")) {
      // Check if this is the right pane by matching the path
      return { ...node, activeTabId: tabId };
    }
    return node;
  }

  return {
    ...node,
    children: node.children.map((child, i) => {
      const childPath = path.includes(".")
        ? path.startsWith("root.")
          ? `root.${i}`
          : `${path}.${i}`
        : `root.${i}`;
      // Only recurse into the matching path
      const segments = path.split(".");
      const targetIndex = parseInt(segments[segments.length - 1] ?? "0", 10);
      if (i === targetIndex || path === "root") {
        return setActiveTabInTree(child, childPath, tabId);
      }
      return child;
    }),
  };
}
