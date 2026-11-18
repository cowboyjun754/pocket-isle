# Pocket Isle (停靠岛)

**English** | [简体中文](./README.zh-CN.md)

> A hand-painted watercolor floating island docked at the edge of your Windows desktop — combining **zero-friction file staging**, **cozy interactive desktop companionship**, a **Pomodoro focus timer**, and an **AI otter assistant** in one lightweight Electron app.

---

## Overview

- **Project Name**: Pocket Isle (`停靠岛`)
- **Platform**: Windows 10 / 11 desktop widget & utility (`Electron 45` · `React 18` · `TypeScript` · `electron-vite` · `Vitest`)
- **App UI Language**: Live switcher supporting **Simplified Chinese (`zh-CN`), Traditional Chinese (`zh-TW`), English (`en`), Japanese (`ja`), Korean (`ko`), and Spanish (`es`)** in **⚙ Settings → General & Docking** or the **System Tray → Language** menu (updates the floating island, control panel, tray menu, dialogs, notifications, and AI prompts without restart).
- **Design Principles**: **Never alter original disk files** · **Lightweight & unobtrusive** · **100% functional offline without AI**

---

## Why Pocket Isle?

Everyday work on Windows often creates small friction points:

1. **Messy temporary file transfers**: Passing screenshots, exports, and documents back and forth between chat apps (e.g., WeChat), browsers, and folders clutters the Desktop—and files inside `%TEMP%` or chat caches can expire or break drag-and-drop paths.
2. **Cold utility toolbars**: Rigid always-visible drop zones eat screen space, whereas hidden tools aren't there when you reach for them.
3. **Lightweight focus companionship**: A quiet 25+5 Pomodoro buddy that helps organize work batches and lets you unwind on a tiny painted island between sessions.

**Pocket Isle** stays tucked along the left or right screen edge as a `320×240` transparent watercolor island: idling down to a `56px` wooden pier with a peeking otter, gliding out smoothly on hover or drag-in, supporting native drag-out to external apps, or letting you toss staged parcels back into the sea with a splash.

---

## Key Features

### 1. Three-Stage Edge Docking & Smooth Window Physics
- **`docked` (`56px` exposed)**: Rests unobtrusively along the left/right screen edge showing the pier tip, mooring bollard, item count badge, and sitting otter. Transparent regions are click-through (`setIgnoreMouseEvents(..., { forward: true })`) so underlying windows stay unobstructed.
- **`peek` (`148px` exposed)**: Slides out the full wooden pier on mouse hover or file drag-over, displaying the 3 most recent parcels mapped by file type (**scroll** for documents, **box** for images/archives, **envelope** for text/code, plus `+N` badge when more exist), with hover nameplates and one-line AI summaries.
- **`full` (`320×240`)**: Left-click the pier to expand the entire island. Dragging within `64px` of either screen edge snaps it back cleanly; dragging toward the center enters free-floating mode. Window movement runs via `requestAnimationFrame`-synced `setPosition` displacement to avoid DWM redraw stutter, and multi-monitor `display-metrics-changed` / `display-removed` events automatically clamp and reconcile positions.

### 2. Conflict-Free File Staging & Gestures
- **Instant Capture**:
  - Drag local files or folders onto the island or panel.
  - Press **`Ctrl+V`** while focused on the island or panel to snapshot clipboard images or plain text into safe local copies.
  - **Safe Storage Policy**: Normal local paths are stored as references without copying; items from `%TEMP%`, app cache directories, or the clipboard are safely copied into `%APPDATA%\pocket-isle\dock-copies` (configurable quota, default `2 GB`, with pre-reserved atomic concurrency checks and tombstone cleanup).
- **Dual Mouse Gestures**:
  - **Left-drag a parcel**: Invokes native OS `webContents.startDrag` to drop files directly into chat windows, desktops, or browser upload inputs.
  - **Right-drag into the sea** (or click **`🌊 Toss in sea`** / **`🌊 扔海里`** on the hover card): An animated hand lifts the parcel and drops it into the water with ripples, removing only the staged entry / app-managed copy (**original disk files are never deleted**), with a 20-second undo pill/banner.
- **430×580 Control Panel** (right-click or double-click the pier):
  - Supports **`📌`** focus-pinning and native titlebar dragging.
  - Includes keyword search (`Ctrl+F`), inline group editing, image thumbnails (cached cleanly by `mtimeMs`), 64 KB plain-text/code preview modal, clipboard copy actions, and reveal-in-Explorer.

### 3. Cozy Island Interactions & Persistent Memory
- **6 Modular Watercolor Decorations + 3 Ambiences**: Toggle wildflowers, wooden bench, street lamp, round tree, cozy cabin, and rotating windmill blades independently; switch between **Day**, **Night** (warm glow + fireflies), and **Rain** (diagonal rain streaks + sea rings).
- **Persistent Island Memory**: Grass sprouts planted by clicking empty turf, manual lamp lighting, and cabin window warmth persist across restarts.
- **Interactive Spots & Toy**: Tap the otter, bench, wildflowers (butterflies), tree canopy (falling leaves), picnic tea set (steam & hearts), starfish, ocean ripples, or drag the paper boat onto the waves.

### 4. Local Document Reader, Focus Timer & AI Otter Companion
- **Zero-Heavy-Dependency Local Extraction** (offloaded to `worker_threads` with byte/concurrency budgets & abort support):
  - Reads plain text/code/Markdown/CSV files.
  - Extracts `.docx` paragraph XML, `.pptx` slide text, `.xlsx` sheet previews (workbook sheets, shared strings, first 40 rows), and `.pdf` `FlateDecode` streams / `ToUnicode` CMap text (image-only PDFs are reported honestly as `meta-only`).
  - Optional compressed **Vision** image thumbnail analysis.
- **Cancellable AI Workflows**:
  - **AI Organize (`✦ AI Organize` / `✦ AI 整理`)**: Groups staged items (selected / search-filtered / all) and generates concise summaries & cautions.
  - **Joint Summary (`✦ Joint Summary` / `✦ 联合速览`)**: Cross-reads 2–6 selected files with an optional focus direction prompt and produces a copyable Markdown card with honest file-read receipts.
  - **Focus Breakdown**: Turns a focus goal plus explicitly selected documents into 1 target and 3 checkable micro-steps.
  - **Decor Recommender**: Suggests island decorations and ambience matching your mood prompt.
- **OpenAI-Compatible Endpoints & Strict Origin Secrets**:
  - Supports any `/v1/chat/completions` endpoint with templates for **DeepSeek, Qwen (DashScope), OpenAI, local Ollama (`localhost:11434`), and LM Studio (`127.0.0.1:1234`)**.
  - Remote endpoints require `https://` (`http://` restricted to loopback hosts).
  - API keys are stored per normalized origin (`protocol + host + port`) using Electron `safeStorage` encryption and never exposed back to the renderer (`hasApiKey` only).
- **Independent Focus Timer**: Customizable presets & durations (`1–180m` focus, `1–60m` rest), 15s checkpoint persistence, auto-pause on screen lock/suspend, desktop completion notifications, and Web Audio chime.

---

## Tech Stack & Architecture

- **Stack**: Electron `45.3.4` · React `18` · TypeScript `5.6` · `electron-vite 2.3.0` · Vitest `2.1`
- **Repository Layout**:
  ```text
  src/
  ├── main/
  │   ├── index.ts                # Windows, tray, pointer polling, IPC sender guards, W3C async clipboard & safeStorage
  │   ├── dock.ts                 # Staging list, dedup, reserved-quota copies, undo & tombstone reconciliation
  │   ├── aiSecrets.ts            # Per-origin encrypted credential store & URL scheme enforcement
  │   ├── fileExtractor.ts        # Text / DOCX / PPTX / XLSX / PDF parser
  │   ├── extractWorker.ts        # Worker thread entry for heavy document parsing
  │   ├── workerExtractRunner.ts  # Worker lifecycle, abort & cleanup coordinator
  │   ├── summaryGuard.ts         # Schema sanitizer for AI & persisted summary payloads
  │   ├── aiService.ts            # Prompting, budgets, abort propagation & OpenAI-compatible client
  │   ├── focusTimer.ts           # Focus/rest timer state machine with checkpoint flushing
  │   ├── store.ts                # Atomic JSON persistence & dirty-flag recovery callbacks
  │   └── ...                     # Clipboard naming, path rules, settings rules, icon renderer & unit tests
  ├── preload/
  │   └── index.ts                # Sandboxed contextBridge window.isle API
  ├── shared/
  │   ├── types.ts                # Shared IPC contracts & domain models
  │   ├── i18n.ts                 # Typed zh-CN / en localization dictionaries & runtime locale resolver
  │   ├── shape.ts                # Stage geometry, hit regions & multi-display clamping math
  │   ├── dropPaths.ts            # Drag-and-drop payload extraction & dropEffect rules
  │   ├── parcelKind.ts           # Extension-to-parcel sprite mapping
  │   └── aiProvider.ts           # Provider origin normalization & locale-aware presets/metadata
  └── renderer/src/
      ├── Island.tsx              # Desktop island coordinator
      ├── island/                 # Modularized stage math, PNG assets, parcel gestures, SVG decor & hit regions
      ├── Panel.tsx               # Operations panel coordinator
      ├── panel/                  # Modularized Dock/Focus/Build/Settings tabs, PreviewModal & useAiTask hook
      ├── util.ts                 # Formatting & explicit AI selection-scope helpers
      └── assets/                 # Layered hand-painted watercolor PNG assets
  scripts/
  ├── make-ico.mjs                # Pure-Node multi-size Windows .ico generator
  └── package-win.mjs             # Builds standalone release/停靠岛/ directory & shortcut
  ```

---

## Getting Started (Windows)

### Prerequisites
- **OS**: Windows 10 / 11 (x64)
- **Node.js**: **v22.12.0+** (required by Electron 45)

### Install, Run & Package

```bash
# 1. Clone the repository
git clone https://github.com/cowboyjun754/pocket-isle.git
cd pocket-isle

# 2. Install npm packages
npm install

# 3. Ensure Electron 45 binary & type definitions are downloaded (required before tsc/dev/package)
node node_modules/electron/install.js

# 4. Build and launch in Electron
npm run build
npx electron .

# Package standalone portable Windows folder (outputs release/停靠岛/停靠岛.exe & shortcut)
npm run package

# Hot-reload dev mode
npm run dev
```

For silent relaunches on Windows without leaving a console window open, you can run `start-pocket-isle.bat` (or `start-pocket-isle.vbs`), which gracefully signals `--quit` to any existing instance matching the workspace binary before launching the packaged or dev build.

### Verification Commands

```bash
# Strict TypeScript check
npm run typecheck

# Unit test suite (14 test files, 77 tests)
npm test

# Production build (main + preload + renderer)
npm run build

# Full Windows standalone packaging
npm run package
```

---

## Privacy & Data Handling

- **Zero Telemetry**: Aside from user-initiated AI requests or "Test Connection" checks sent strictly to the user-configured LLM endpoint, Pocket Isle performs no background network requests or analytics.
- **Local-Only User State**: Settings, staged references, copies (`dock-copies`), and `safeStorage`-encrypted credentials live strictly in `%APPDATA%\pocket-isle\data.json` outside the repository and packaged folder.
- **Original Files Never Touched**: Grouping, summarizing, clearing, or tossing parcels into the sea only modifies Pocket Isle's internal dock index or its own temporary copies—never your original disk files.
