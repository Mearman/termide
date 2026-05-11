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

  dragTabStart: (data) => {
    ipcRenderer.send("drag-tab-start", data);
  },

  dragTabEnd: (completed) => {
    ipcRenderer.send("drag-tab-end", completed);
  },
});
