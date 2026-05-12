/**
 * Preload script — exposes a safe IPC bridge to the renderer.
 *
 * Runs in sandbox mode. In Electron's sandbox, contextBridge and ipcRenderer
 * are NOT globals — they must be obtained from require('electron'), which
 * is a special sandbox-aware function injected by Electron.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getWindowId: () => ipcRenderer.sendSync("get-window-id"),

  getInitialState: () => ipcRenderer.sendSync("get-initial-state"),

  onStateUpdated: (callback) => {
    ipcRenderer.on("state-updated", (_event, state) => callback(state));
    return () => ipcRenderer.removeListener("state-updated", callback);
  },

  onDragEnter: (callback) => {
    ipcRenderer.on("drag-enter", (_event, data) => callback(data));
    return () => ipcRenderer.removeListener("drag-enter", callback);
  },

  onDragLeave: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("drag-leave", handler);
    return () => ipcRenderer.removeListener("drag-leave", handler);
  },

  tabMovedIntra: (data) => {
    ipcRenderer.send("tab-moved-intra", data);
  },

  /** Toggle whether a tab is pinned. */
  toggleTabPin: (tabId) => {
    ipcRenderer.send("toggle-tab-pin", tabId);
  },

  /** Open a tab by title (preview model). */
  openTab: (title) => {
    ipcRenderer.send("open-tab", title);
  },

  /** Toggle the dirty/modified state of a tab. */
  toggleTabDirty: (tabId) => {
    ipcRenderer.send("toggle-tab-dirty", tabId);
  },

  /** Renderer tells main process a cross-window drag has begun. */
  tabDragBegin: (data) => {
    ipcRenderer.send("tab-drag-begin", data);
  },

  /** Renderer tells main process the cross-window drag ended. */
  tabDragEnd: (completed) => {
    ipcRenderer.send("tab-drag-end", completed);
  },

  /** Report that a drag is over this window (for broadcast-based cross-window detection). */
  dragTargetEnter: (windowId) => {
    ipcRenderer.send("drag-target-enter", windowId);
  },

  /** Report that a drag left this window. */
  dragTargetLeave: (windowId) => {
    ipcRenderer.send("drag-target-leave", windowId);
  },

  // ─── Test-only APIs ────────────────────────────────────

  /** Create a second test window. Returns the new window ID. */
  testCreateWindow: () => {
    return ipcRenderer.invoke("test-create-window");
  },

  /** Override drag coordinator's hovered window for testing. */
  testSetDragTarget: (windowId) => {
    return ipcRenderer.sendSync("test-set-drag-target", windowId);
  },

  /** Move a window to specific screen coordinates for headed tests. */
  testPositionWindow: (opts) => {
    return ipcRenderer.sendSync("test-position-window", opts);
  },
});
