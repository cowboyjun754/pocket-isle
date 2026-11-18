# Pocket Isle — Engineering & Handoff Guide

> Quick architectural reference for maintainers and agents picking up `D:\Pocket Isle`.

---

## 1. Repository & Tooling Overview
- **Workspace Root**: `D:\Pocket Isle`
- **GitHub Remote**: `https://github.com/cowboyjun754/pocket-isle` (`main` branch)
- **Runtime & Toolchain**: Electron `45.3.4` + React `18.3` + TypeScript `5.6` + `electron-vite 2.3.0` (`electron.vite.config.mjs`)
- **Silent Windows Launchers**:
  - Daily launch: root `停靠岛.lnk` shortcut or `release\停靠岛\停靠岛.exe`.
  - Clean restart/switch: `start-pocket-isle.vbs` (invoked cleanly via `start-pocket-isle.bat`), matching only processes whose exact `ExecutablePath` belongs to this directory, sending `--quit` with a 2.5s wait (and prompting on timeout), then launching the packaged `release\停靠岛\停靠岛.exe` (or falling back to `electron.exe .`).
  - Portable packaging: `npm.cmd run package` runs `electron-vite build` + `scripts/package-win.mjs`, generating `build/icon.ico` and staging `release/停靠岛/停靠岛.exe` safely via `.staging` / `.backup` swaps (`app.isPackaged === true` enables `openAtLogin`).
- **Verification**:
  - `npm.cmd run typecheck` (`tsc --noEmit`)
  - `npm.cmd test` (`vitest run` — 13 test files, 69 unit tests)
  - `npm.cmd run build` (`electron-vite build`)
  - `npm.cmd run package` (auto-invokes `node_modules/electron/install.js` if `electron.exe` is missing)

---

## 2. Core Architecture (v3)
1. **Left/Right Edge 3-Stage Docking** (`src/shared/shape.ts`, `src/main/index.ts`):
   - `docked` (`56px`): Exposes pier front edge, rope bollard, count badge `(17, 74)`, and sitting otter `(35, 118)`.
   - `peek` (`148px`): Hover or file drag-over slides out the full horizontal pier with the latest 3 file-kind parcels (`scroll`, `box`, `envelope`), `+N` overflow pill `(46, 82)`, native left-click `startDrag` out to external apps, and right-drag / hover button sea-drop removal.
   - `full` (`320×240`): Left-click pier expands the whole island; right-click or double-click opens the `430×580` operations panel (supports focus pinning and `-webkit-app-region: drag`).
   - Smooth dragging uses `requestAnimationFrame` in the renderer calling main `setPosition`, snapping cleanly within `64px` of left/right edges.
2. **Layered Watercolor Assets** (`src/renderer/src/assets/`):
   - Base scene: `island-horiz.png`
   - 6 toggleable decorations: `deco-flowers.png`, `deco-bench.png`, `deco-lamp.png`, `deco-tree.png`, `deco-cabin.png`, `deco-windmill.png` + spinning `deco-windmill-blades.png`
   - 5 otter poses (`idle`, `receive`, `read`, `wave`, `rest`), 3 parcel sprites, and `paper-boat.png`.
3. **Interactive Island & Memory** (`src/renderer/src/Island.tsx`, `src/renderer/src/island/*`, `src/main/store.ts`):
   - Grass flower sprouts, manual lamp state, and warm cabin windows persist in `store.ts`.
   - Night/rain ambiences render fireflies, water glints, chimney smoke, and diagonal rain streaks; `.is-sleeping-fx` pauses idle animations when docked.
4. **Control Panel & AI Companion** (`src/renderer/src/Panel.tsx`, `src/renderer/src/panel/*`, `src/main/aiService.ts`, `src/main/focusTimer.ts`):
   - 4 tabs (`Dock`, `Focus`, `Build`, `Settings`), single `useAiTask` request-sequence coordinator, cancellation support, explicit document selection for focus breakdowns, search-scoped AI organize, and per-origin masked AI configuration with non-overwriting connection tests.

---

## 3. Hardening, Refactor & Upgrade History

### Phase 1–3 Hardening (Backend, IPC, Extraction & Windows Reliability)
1. **Per-Origin Secret Isolation & Explicit AI Scopes**:
   - Normalized endpoint origin (`protocol + host + port`) encrypted via Electron `safeStorage` (`src/main/aiSecrets.ts`); config broadcasts strip secrets (`hasApiKey` only); remote endpoints require `https://` (`http://` allowed only for loopback).
   - "Test Connection" sends draft values directly without overwriting saved config; Focus AI sends only explicitly selected docs; Dock AI honors search filter scope; copy/preview preserves original whitespace/indentation.
2. **Honest Parsing, `worker_threads` Extraction & Storage Recovery**:
   - Heavy Office/PDF extraction runs inside `src/main/extractWorker.ts` (`src/main/workerExtractRunner.ts` + `src/main/fileExtractor.ts`) with concurrency/byte budgets and abort propagation; fixed 41+ row Excel truncation reporting, scanned-only PDF `meta-only` status, Vision >4 image truncation notes, and folder notices.
   - `summaryGuard.ts` validates AI and persisted summary schemas; `Dock` serializes concurrent imports/quota reservations, retains 20s undo state, tracks `pendingDeletes` tombstones across retries, and keeps `drop-log.txt` disabled unless `POCKET_ISLE_DROP_LOG=1`.
3. **Startup Safety, Multi-DPI & Power Hygiene**:
   - `start-pocket-isle.vbs` checks exact `ExecutablePath` and asks before force-closing; `display-metrics-changed` / `display-removed` recompute island & panel placement (`reconcileIslandPosOnDisplayChange` / `clampPanelBoundsToWorkArea`); `FocusController` checkpoints every 15s; IPC verifies `sender` and main frame; executable extensions prompt confirmation before shell open; pointer polling pauses when hidden/locked/suspended; thumbnails cache cleanly with `mtimeMs`.

### Phase 4 & Electron 45 Upgrade (`13` Test Files / `69` Unit Tests Passing)
1. **Panel Modularization** (`src/renderer/src/Panel.tsx` + `src/renderer/src/panel/`): Split into `panelShared.tsx`, `useAiTask.ts`, `PreviewModal.tsx`, `DockTab.tsx`, `FocusTab.tsx`, `BuildTab.tsx`, `SettingsTab.tsx`; deduplicated countdown formatting via `formatDurationMmSs` in `src/renderer/src/util.ts`.
2. **Island Modularization & Tests** (`src/renderer/src/Island.tsx` + `src/renderer/src/island/`): Split into `islandMath.ts`, `islandMath.test.ts`, `islandAssets.ts`, `IslandDecorSvg.tsx`, `ParcelLayer.tsx`, `HitRegionsSvg.tsx`, `useParcelGestures.ts` with identical DOM classes, IPC contracts, and interaction behavior.
3. **Electron `45.3.4` Upgrade & Async Clipboard**:
   - Upgraded `electron` from `^33.2.0` (`33.4.11`) to `^45.3.4` (`45.3.4`); adapted `src/main/index.ts` clipboard handlers (`dock:pasteClipboard`, `dock:copyToClipboard`) to Electron 44+ W3C async `Clipboard` / `ClipboardItem` APIs (`clipboard.read()`, `clipboard.write()`, `await clipboard.readText()`, `await clipboard.writeText()`).
   - Updated `scripts/package-win.mjs` to auto-fetch missing Electron binaries via `node_modules/electron/install.js` before staging.
   - **Next-Upgrade Note (Electron 46+)**: Sync `safeStorage` methods (`isEncryptionAvailable`, `encryptString`, `decryptString`) are marked `@deprecated` in Electron 45 and scheduled for removal in Electron 46; migrate `safeCodec` and `src/main/aiSecrets.ts` to `*Async()` before jumping to v46.
   - **Runtime Data Location**: User config, staged files, and encrypted credentials live in `%APPDATA%\pocket-isle\data.json` outside this repo; never commit or leak personal config data.
