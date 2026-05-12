# Electron Tab Drag Prototype

A prototype Electron application demonstrating VSCode-style tab and pane management — intra-window split panes, inter-window tab dragging, preview tabs, pinning, and more. Built as a research artefact for evaluating multi-window tab dragging approaches in TypeScript desktop applications.

## Architecture

```
packages/
├── main/          Electron main process (TypeScript via --experimental-strip-types)
├── renderer/      React + Vite + react-mosaic v7
└── e2e/           Playwright E2E tests (27 tests, headless)
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
| `src/App.tsx` | Mosaic integration, layout tree converters, event delegation, context menu, tile content |
| `src/index.css` | Catppuccin Mocha dark theme, Blueprint.js overrides, custom tab bar styles |
| `src/main.tsx` | React entry point |
| `src/types.ts` | Shared types matching main process |

### Layout Engine: react-mosaic v7

The layout is powered by [react-mosaic v7](https://github.com/nomcopter/react-mosaic) which provides:

- N-ary split trees with tabs as first-class citizens
- Built-in react-dnd for intra-window tab drag, reorder, and pane splitting
- `MosaicTabsNode` (tab groups) and `MosaicSplitNode` (splits)
- Drop targets between tabs and on pane edges

Our `LayoutNode` tree is bidirectionally converted via `toMosaicNode()` / `fromMosaicNode()`.

### Layout Tree

```
LayoutNode = PaneNode | SplitNode

PaneNode   = { type: "pane", tabIds: string[], pinnedTabIds: string[], activeTabId: string }
SplitNode  = { type: "split", direction: "row" | "column", children: LayoutNode[], sizes: number[] }
```

Tabs are stored in a flat `Record<string, Tab>` dictionary per window. The layout tree references tab IDs. Mutations (move, split, close, reorder) operate on the tree and sync to the main process via IPC.

## Features

### Intra-window (react-mosaic + react-dnd)

- **Tab reordering** — drag within the same tab bar
- **Cross-pane moves** — drag from one pane to another's tab bar
- **Dynamic splitting** — drag to pane edges to create new splits
- **Resize handles** — drag between split panes to adjust sizes
- **Automatic cleanup** — empty panes are removed, single-child splits are collapsed
- **Tab bar scrolling** — horizontal scroll for panes with many tabs

### Cross-window (main process coordination)

- **BroadcastChannel** — renderers broadcast `drag-target-enter`/`drag-target-leave` for fast detection
- **Cursor polling fallback** — `screen.getCursorScreenPoint()` at 16ms intervals when no broadcast received
- **Tear-off** — drag ending outside all windows creates a new BrowserWindow with the tab
- **Drop on existing window** — move or copy between windows
- **Ghost window** — Catppuccin-themed semi-transparent card follows cursor outside source window
- **Drop overlay** — translucent blue overlay with dashed border when dragging over a target window
- **Empty window cleanup** — source window closes when all tabs are dragged out

### Tab model

- **Pinned tabs** — right-click → Pin; pinned tabs rendered with 📌 badge
- **Preview tabs** — new tabs open as preview; replaced on next open; double-click to pin
- **Dirty indicator** — ● badge on modified tabs; content area "Edit"/"Save" toggle
- **Close** — click × button, middle-click, or right-click → Close; last tab in a pane collapses the pane
- **Context menu** — right-click for Pin/Unpin and Close
- **New tab** — + button at end of tab bar opens a new tab
- **Badges** — 📌 pinned, "preview" (italic), ● dirty

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

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **react-mosaic v7 for layout** | N-ary trees, tabs as first-class, built-in react-dnd |
| **`renderTabTitle` + event delegation** (not `renderTabToolbar`) | `renderTabToolbar` breaks mosaic's stable drop targets: `DraggableTab.begin()` → `hide()` → re-render → `useDrop` loses DOM connection → `dragTo` hangs |
| **`canClose="canClose"` for close buttons** | Mosaic renders close buttons and handles tree mutations internally |
| **DOM event delegation** for context menu / middle-click | `contextmenu` + `auxclick` on root; no per-button listeners |
| **No lodash** | Custom `pathsEqual()` for `MosaicPath` (number[]) comparison |
| **Blueprint.js icon purge** | Mosaic's `bp5-icon-cross` is empty without Blueprint CSS; × rendered via `::after` |
| Electron over Tauri/NodeGUI | Only framework with proven multi-window tab dragging (VSCode) |
| BroadcastChannel + cursor polling hybrid | BroadcastChannel is instant but only works when renderers respond; polling is the fallback |
| Lazy ghost window (5-tick debounce) | Avoids creating BrowserWindows during brief drags that end immediately |
| `destroy()` not `close()` for ghost | Prevents `loadURL` from blocking teardown |
| IIFE preload format | Electron sandbox mode prohibits ES module imports in preload |
| `--experimental-strip-types` | Run main process TypeScript directly; no build step in dev |

## Test Results

**27 pass, 0 fail, 2 skip** (headed-only cross-window tests).

| Suite | Tests | Status |
|---|---|---|
| App basics | 7 | ✅ |
| Intra-window tab activation/drag | 5 | ✅ |
| Tab reorder + pane splitting | 5 | ✅ |
| Cross-window tab drag (IPC) | 6 | ✅ |
| Preview tabs | 4 | ✅ |
| Headed cross-window (real mouse) | 2 | ⏭️ skipped (needs `HEADLESS=0`) |

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

## Related Research

- [Multi-Window Tab Dragging](https://github.com/Mearman/termide) — Obsidian research note with VSCode source analysis (30 GitHub permalinks)
- [GUI Applications from TypeScript](https://github.com/Mearman/termide) — Framework comparison (Electron, Tauri, NodeGUI, etc.)
- [Native Binaries from TypeScript](https://github.com/Mearman/termide) — Node SEA, Deno compile, Bun compile comparison

## License

MIT
