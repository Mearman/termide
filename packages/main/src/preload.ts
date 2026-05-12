// @ts-nocheck
// Preload runs in Electron sandbox as IIFE — cannot import types,
// and require('electron') returns `any` in sandbox context.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getWindowId: () => ipcRenderer.sendSync("get-window-id"),
  getInitialState: () => ipcRenderer.sendSync("get-initial-state"),

  onStateUpdated: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("state-updated", handler);
    return () => ipcRenderer.removeListener("state-updated", handler);
  },

  onDragEnter: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("drag-enter", handler);
    return () => ipcRenderer.removeListener("drag-enter", handler);
  },

  onDragLeave: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("drag-leave", handler);
    return () => ipcRenderer.removeListener("drag-leave", handler);
  },

  tabMovedIntra: (data) => ipcRenderer.send("tab-moved-intra", data),

  toggleTabPin: (tabId) => ipcRenderer.send("toggle-tab-pin", tabId),
  openTab: (title) => ipcRenderer.send("open-tab", title),
  toggleTabDirty: (tabId) => ipcRenderer.send("toggle-tab-dirty", tabId),

  tabDragBegin: (data) => ipcRenderer.send("tab-drag-begin", data),
  tabDragEnd: (completed) => ipcRenderer.send("tab-drag-end", completed),
  dragTargetEnter: (windowId) => ipcRenderer.send("drag-target-enter", windowId),
  dragTargetLeave: (windowId) => ipcRenderer.send("drag-target-leave", windowId),
  dragTargetPane: (paneId) => ipcRenderer.send("drag-target-pane", { paneId }),

  // ─── Test-only APIs ────────────────────────────────────

  testCreateWindow: () => ipcRenderer.invoke("test-create-window"),
  testSetDragTarget: (windowId) => ipcRenderer.sendSync("test-set-drag-target", windowId),
  testPositionWindow: (opts) => ipcRenderer.sendSync("test-position-window", opts),
  testSetSplitLayout: (windowId) => ipcRenderer.sendSync("test-set-split-layout", windowId),
});
