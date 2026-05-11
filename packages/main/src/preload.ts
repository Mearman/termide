/**
 * Preload script — exposes a safe IPC bridge to the renderer.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getWindowId: (): number => ipcRenderer.sendSync("get-window-id"),

  getInitialState: (): unknown => ipcRenderer.sendSync("get-initial-state"),

  onStateUpdated: (callback: (state: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown): void => {
      callback(state);
    };
    ipcRenderer.on("state-updated", handler);
    return () => ipcRenderer.removeListener("state-updated", handler);
  },

  onDragEnter: (callback: (data: { tabId: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { tabId: string }): void => {
      callback(data);
    };
    ipcRenderer.on("drag-enter", handler);
    return () => ipcRenderer.removeListener("drag-enter", handler);
  },

  onDragLeave: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on("drag-leave", handler);
    return () => ipcRenderer.removeListener("drag-leave", handler);
  },

  tabMovedIntra: (data: unknown): void => {
    ipcRenderer.send("tab-moved-intra", data);
  },

  dragTabStart: (data: unknown): void => {
    ipcRenderer.send("drag-tab-start", data);
  },

  dragTabEnd: (completed: boolean): void => {
    ipcRenderer.send("drag-tab-end", completed);
  },
});
