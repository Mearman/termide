// @ts-nocheck
// Preload runs in Electron sandbox as IIFE — cannot import types,
// and require('electron') returns `any` in sandbox context.

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

  tabMovedIntra: (data) => ipcRenderer.send("tab-moved-intra", data),

  toggleTabPin: (tabId) => ipcRenderer.send("toggle-tab-pin", tabId),
  openTab: (title) => ipcRenderer.invoke("open-tab", title),
  toggleTabDirty: (tabId) => ipcRenderer.invoke("toggle-tab-dirty", tabId),

  tabDragBegin: (data) => ipcRenderer.send("tab-drag-begin", data),
  tabDragEnd: (completed) => ipcRenderer.send("tab-drag-end", completed),
  dragTargetEnter: (windowId) => ipcRenderer.send("drag-target-enter", windowId),
  dragTargetLeave: (windowId) => ipcRenderer.send("drag-target-leave", windowId),

  // ─── Test-only APIs ────────────────────────────────────

  testCreateWindow: () => ipcRenderer.invoke("test-create-window"),
  testSetDragTarget: (windowId) => ipcRenderer.sendSync("test-set-drag-target", windowId),
  testPositionWindow: (opts) => ipcRenderer.sendSync("test-position-window", opts),
});
