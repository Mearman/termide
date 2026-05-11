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

  /** Renderer tells main process a cross-window drag has begun. */
  tabDragBegin: (data) => {
    ipcRenderer.send("tab-drag-begin", data);
  },

  /** Renderer tells main process the cross-window drag ended. */
  tabDragEnd: (completed) => {
    ipcRenderer.send("tab-drag-end", completed);
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
});
