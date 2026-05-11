/**
 * Window creation and management.
 */
import {
  BrowserWindow,
  type Point,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerWindow, createWindowForTab, appState } from "./state.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPackage = path.resolve(__dirname, "..");

const RENDERER_URL =
  process.env.RENDERER_URL ?? "http://localhost:5173";

const isDev = !RENDERER_URL.startsWith("file://");

function preloadPath(): string {
  return path.join(mainPackage, "dist", "preload.iife.js");
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: "Tab Drag Prototype",
  });

  registerWindow(win.id);

  if (isDev) {
    win.loadURL(RENDERER_URL);
  } else {
    win.loadFile(path.join(mainPackage, "..", "renderer", "dist", "index.html"));
  }

  return win;
}

export function createWindowWithTab(
  tabId: string,
  fromWindowId: number,
  cursor: Point,
): BrowserWindow | undefined {
  const win = new BrowserWindow({
    width: 600,
    height: 400,
    x: cursor.x - 300,
    y: cursor.y - 200,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: "Tab Drag Prototype",
  });

  createWindowForTab(tabId, fromWindowId, win.id);

  if (isDev) {
    win.loadURL(RENDERER_URL);
  } else {
    win.loadFile(path.join(mainPackage, "..", "renderer", "dist", "index.html"));
  }

  return win;
}
