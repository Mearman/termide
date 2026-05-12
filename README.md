# Electron Tab Drag Prototype

A prototype Electron application demonstrating VSCode-style tab and pane management — intra-window split panes, inter-window tab dragging, preview tabs, pinning, and more. Built as a research artefact for evaluating multi-window tab dragging approaches in TypeScript desktop applications.

## Architecture

```
packages/
├── main/          Electron main process (TypeScript, Node 24)
├── renderer/      React + Vite frontend
└── e2e/           Playwright E2E tests (30 tests, headless)
```

### Main Process (`packages/main`)

| File | Responsibility |
|------|---------------|
| `src/index.ts` | App lifecycle, IPC handlers, window creation |
| `src/state.ts` | Per-window state: layout tree, tab registry, mutations |
| `src/window-manager.ts` | BrowserWindow creation for main and auxiliary windows |
| `src/drag-coordinator.ts` | Cross-window drag tracking: BroadcastChannel + cursor polling, ghost window |
| `src/preload.ts` | IIFE sandbox preload bridge (`contextBridge` + `ipcRenderer`) |
| `src/types.ts` | Shared types: `Tab`, `LayoutNode`, `PaneNode`, `SplitNode` |

### Renderer (`packages/renderer`)

| File | Responsibility |
|------|---------------|
| `src/App.tsx` | Layout tree rendering, mutation functions (move/copy/split/close) |
| `src/components/Pane.tsx` | Tab bar + content area: HTML5 DnD, insertion indicators, drop overlay |

### Layout Tree

The window layout is a recursive union type:

```
LayoutNode = PaneNode | SplitNode

PaneNode   = { type: "pane", tabIds: string[], pinnedTabIds: string[], activeTabId: string }
SplitNode  = { type: "split", direction: "row" | "column", children: LayoutNode[], sizes: number[] }
```

Tabs are stored in a flat `Record<string, Tab>` dictionary per window. The layout tree references tab IDs. Mutations (move, split, close, reorder) operate on the tree and sync to the main process via IPC.

## Features

### Intra-window (HTML5 DnD, renderer-only)

- **Tab reordering** — drag within the same tab bar
- **Cross-pane moves** — drag from one pane to another's tab bar
- **Copy on drag** — Alt+drag (macOS) or Ctrl+drag (Linux/Windows) duplicates the tab
- **Dynamic splitting** — drop on edge split zones (10% threshold) to create new panes
- **Insertion indicators** — blue bar shows drop position in target tab bar
- **Drop overlay** — visual merge/split zones on content area during drag
- **Auto-activate** — hovering a tab during drag for 1.5s activates it

### Cross-window (main process coordination)

- **BroadcastChannel** — renderers broadcast `drag-target-enter`/`drag-target-leave` for fast detection
- **Cursor polling fallback** — `screen.getCursorScreenPoint()` at 16ms intervals when no broadcast received
- **Tear-off** — drag ending outside all windows creates a new BrowserWindow with the tab
- **Drop on existing window** — move or copy between windows
- **Ghost window** — debounced semi-transparent overlay follows cursor outside source window
- **Empty window cleanup** — source window closes when all tabs are dragged out

### Tab model

- **Pinned tabs** — double-click to pin; compact 38px icon-only rendering; separator between pinned/unpinned
- **Preview tabs** — new tabs open as preview (italic); replaced on next open; double-click to pin
- **Dirty indicator** — filled dot (●) replaces close button on modified tabs; right-click to toggle
- **Close** — click × or middle-click; last tab in a pane collapses the pane
- **New tab** — + button at end of tab bar opens a preview tab

### Pane management

- **Resize handles** — drag between split panes to adjust sizes
- **Automatic cleanup** — empty panes are removed, single-child splits are collapsed

## IPC Protocol

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `get-initial-state` | renderer → main | sync | Returns `WindowStateFromMain` |
| `get-window-id` | renderer → main | sync | Returns window's BrowserWindow ID |
| `state-updated` | main → renderer | push | Pushes state after mutations |
| `tab-moved-intra` | renderer → main | async | Syncs layout tree after intra-window drag |
| `toggle-tab-pin` | renderer → main | async | Toggles pinned state |
| `toggle-tab-dirty` | renderer → main | async | Toggles dirty indicator |
| `open-tab` | renderer → main | async | Opens a tab (preview model) |
| `tab-drag-begin` | renderer → main | async | Signals potential cross-window drag |
| `tab-drag-end` | renderer → main | async | Reports drag completion |
| `drag-target-enter` | renderer → main | async | BroadcastChannel: cursor entered window |
| `drag-target-leave` | renderer → main | async | BroadcastChannel: cursor left window |
| `drag-enter` | main → renderer | push | Cross-window drag entered this window |
| `drag-leave` | main → renderer | push | Cross-window drag left this window |
| `test-create-window` | test → main | async | Creates a hidden BrowserWindow for testing |
| `test-set-drag-target` | test → main | sync | Overrides drag coordinator target |
| `test-position-window` | test → main | sync | Positions a BrowserWindow on screen |

## Development

### Prerequisites

- Node.js ≥ 24 (or 26 with `--experimental-strip-types`)
- pnpm ≥ 10

### Setup

```bash
git clone https://github.com/Mearman/termide.git electron-tab-drag-prototype
cd electron-tab-drag-prototype
pnpm install
```

### Run

```bash
pnpm dev
```

Starts both Vite (renderer) and Electron (main process) in parallel via turbo.

### Test

```bash
cd packages/e2e
pnpm test                    # All headless tests
pnpm test app.spec.ts        # App launch only
HEADLESS=0 pnpm test headed-cross-window.spec.ts  # Headed (requires display)
```

### Build

```bash
cd packages/main && npx tsdown   # Bundle preload IIFE
cd packages/renderer && pnpm build  # Vite production build
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Electron over Tauri/NodeGUI | Only framework with proven multi-window tab dragging (VSCode) |
| HTML5 DnD for intra-window | Stays in renderer; no main process round-trip |
| BroadcastChannel + cursor polling hybrid | BroadcastChannel is instant but only works when renderers respond; polling is the fallback |
| Lazy ghost window (5-tick debounce) | Avoids creating BrowserWindows during brief drags that end immediately |
| `destroy()` not `close()` for ghost | Prevents `loadURL` from blocking teardown |
| IIFE preload format | Electron sandbox mode prohibits ES module imports in preload |
| `--experimental-strip-types` | Run main process TypeScript directly; no build step in dev |
| `unref()` on poll interval | Doesn't prevent process exit when all windows close |
| `destroy()` for ghost windows during teardown | Immediate cleanup prevents test hangs |
| `path.txt` without trailing newline | Electron's `isInstalled()` check is exact-string comparison |

## Related Research

- [Multi-Window Tab Dragging](link) — Obsidian research note with VSCode source analysis (30 GitHub permalinks)
- [GUI Applications from TypeScript](link) — Framework comparison (Electron, Tauri, NodeGUI, etc.)
- [Native Binaries from TypeScript](link) — Node SEA, Deno compile, Bun compile comparison

## License

MIT
