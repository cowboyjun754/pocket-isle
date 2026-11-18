/** Shared domain models & IPC contracts across main, preload, and renderer processes (v3). */

import type { DockSide, ExpandMode } from './shape'

export type DecorationId = 'flowers' | 'bench' | 'lamp' | 'tree' | 'cabin' | 'windmill'
export type OtterAction = 'idle' | 'receive' | 'read' | 'wave' | 'rest'
export type AmbienceMode = 'day' | 'night' | 'rain'
export type ParcelKind = 'envelope' | 'box' | 'scroll'
export type AppLocale = 'zh-CN' | 'en'

export interface FileSummary {
  brief: string
  bullets: string[]
  attention?: string
  readStatus: 'full' | 'partial' | 'meta-only'
  readNote?: string
  updatedAt: number
}

export interface DockItem {
  id: string
  /** Display name (original filename) */
  name: string
  /** Lowercase extension without leading dot */
  ext: string
  /** Active path: referenced path for regular entries, or managed copy path for copies */
  path: string
  /** Original path captured at drop time */
  sourcePath: string
  /** Whether stored as an app-managed copy */
  isCopy: boolean
  /** Whether the entry represents a folder shortcut reference */
  isDir?: boolean
  size: number
  mtimeMs: number
  addedAt: number
  /** In-app group label (virtual organization only; original disk file is never moved) */
  group?: string
  /** AI-generated summary payload */
  summary?: FileSummary
  /** Runtime availability status (not persisted) */
  available?: boolean
}

export interface DecorationState {
  enabled: Record<DecorationId, boolean>
  ambience: AmbienceMode
}

export interface IslandSprout {
  id: number
  x: number
  y: number
  kind: 0 | 1 | 2
}

export interface IslandMemory {
  sprouts: IslandSprout[]
  lampLit: boolean | null
  cabinWarm: boolean | null
}

export interface FocusStep {
  id: string
  text: string
  done: boolean
}

export interface FocusState {
  phase: 'idle' | 'focus' | 'focus_done' | 'rest'
  running: boolean
  remainingMs: number
  totalMs: number
  goal: string
  steps: FocusStep[]
}

export interface AiConfig {
  baseUrl: string
  model: string
  enableVision?: boolean
  hasApiKey?: boolean
  requiresKey?: boolean
}

export interface AiConfigInput {
  baseUrl: string
  model: string
  enableVision?: boolean
  /** When blank and clearApiKey !== true, keeps the saved key for this origin; otherwise updates it */
  apiKey?: string
  /** Explicitly clears the saved credential for the current origin */
  clearApiKey?: boolean
}

export interface AiKeyStatus {
  origin: string
  hasApiKey: boolean
  requiresKey: boolean
  valid: boolean
  message?: string
}

export interface DockUndoState {
  token: string
  count: number
  copyCount: number
  label: string
  expiresAt: number
}

export interface UndoResult {
  ok: boolean
  restored: number
  message: string
}

export interface Settings {
  alwaysOnTop: boolean
  openAtLogin: boolean
  /** Copy storage quota limit in MB */
  copyLimitMB: number
  /** Default focus duration in minutes (1..180) */
  focusMinutes?: number
  /** Default rest duration in minutes (1..60) */
  restMinutes?: number
  /** Play sound & desktop notification on focus/rest completion */
  focusNotify?: boolean
  /** Interface language ('zh-CN' | 'en') */
  locale?: AppLocale
  ai: AiConfig
}

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'alwaysOnTop'
    | 'openAtLogin'
    | 'copyLimitMB'
    | 'focusMinutes'
    | 'restMinutes'
    | 'focusNotify'
    | 'locale'
  >
>

export interface AppEnv {
  isPackaged: boolean
  shortcut: string
}

export interface AddResult {
  added: number
  skipped: number
  errors: string[]
}

export interface IslandPose {
  side: DockSide
  mode: ExpandMode
  hover: boolean
}

export interface OtterReactionPayload {
  action: OtterAction
  bubble?: string
  durationMs?: number
}

export interface AiOrganizeResult {
  ok: boolean
  cancelled?: boolean
  needsSetup?: boolean
  message: string
  otterBubble?: string
}

export interface AiBreakdownResult {
  ok: boolean
  cancelled?: boolean
  needsSetup?: boolean
  message: string
  refinedGoal?: string
  steps?: string[]
  otterBubble?: string
}

export type AiTaskKind = 'organize' | 'joint' | 'breakdown' | 'decor'

export interface AiProgressPayload {
  taskId: string
  kind: AiTaskKind
  stage: string
}

export interface AiFileReadReceipt {
  id: string
  name: string
  readStatus: 'full' | 'partial' | 'meta-only'
  readNote?: string
  imageAttached?: boolean
}

export interface AiJointSummaryResult {
  ok: boolean
  cancelled?: boolean
  needsSetup?: boolean
  message: string
  title?: string
  markdown?: string
  otterBubble?: string
  files?: AiFileReadReceipt[]
}

export interface IsleApi {
  getPathForFile(file: File): string
  listDock(): Promise<DockItem[]>
  addPaths(paths: string[]): Promise<AddResult>
  pasteFromClipboard(): Promise<AddResult>
  remove(ids: string[]): Promise<void>
  clear(): Promise<void>
  undoRemove(token?: string): Promise<UndoResult>
  setItemGroup(ids: string[], group: string | undefined): Promise<void>
  /** Returns empty string on success, or an error message otherwise */
  open(id: string): Promise<string>
  reveal(id: string): Promise<void>
  thumb(id: string, size: number): Promise<string | null>
  readTextPreview(id: string): Promise<{ ok: boolean; content?: string; truncated?: boolean; message?: string }>
  copyItemToClipboard(id: string): Promise<{ ok: boolean; message: string }>
  copyUsage(): Promise<{ used: number; limit: number }>
  getPose(): Promise<IslandPose>
  setExpandMode(mode: ExpandMode): void
  holdExpand(ms: number): void
  startDrag(ids: string[], kind?: ParcelKind): void
  syncDragPassThrough(): void
  beginMoveIsland(): void
  stepMoveIsland(): void
  endMoveIsland(): void
  togglePanel(): void
  hidePanel(): void
  getPanelPinned(): Promise<boolean>
  setPanelPinned(pinned: boolean): Promise<boolean>
  hideIsland(): void

  // Island decorations & persistent memory
  getDecorations(): Promise<DecorationState>
  setDecorations(next: Partial<DecorationState>): Promise<DecorationState>
  getIslandMemory(): Promise<IslandMemory>
  setIslandMemory(patch: Partial<IslandMemory>): Promise<IslandMemory>

  // Focus timer & goal breakdown
  getFocus(): Promise<FocusState>
  focusControl(
    action: 'start_focus' | 'pause' | 'resume' | 'start_rest' | 'reset',
    durationMinutes?: number
  ): Promise<FocusState>
  updateFocusPlan(goal: string, steps: FocusStep[]): Promise<FocusState>

  // AI companion & settings
  getSettings(): Promise<Settings>
  updateSettings(patch: SettingsPatch): Promise<Settings>
  getAppEnv(): Promise<AppEnv>
  resetPosition(side: 'right' | 'left'): void
  openDataDir(): Promise<void>
  getAiKeyStatus(baseUrl: string): Promise<AiKeyStatus>
  saveAiConfig(cfg: AiConfigInput): Promise<{ ok: boolean; message?: string }>
  testAiConnection(cfg: AiConfigInput): Promise<{ ok: boolean; message: string }>
  aiOrganizeDock(ids?: string[], taskId?: string): Promise<AiOrganizeResult>
  aiJointSummary(ids: string[], focusPrompt?: string, taskId?: string): Promise<AiJointSummaryResult>
  aiBreakdownGoal(
    goal: string,
    docIds: string[],
    durationMinutes?: number,
    taskId?: string
  ): Promise<AiBreakdownResult>
  aiRecommendDecor(
    moodPrompt?: string,
    taskId?: string
  ): Promise<{ ok: boolean; cancelled?: boolean; needsSetup?: boolean; message: string }>
  cancelAi(): void

  // Event subscriptions
  onDockChanged(cb: () => void): () => void
  onDockUndoChanged(cb: (u: DockUndoState | null) => void): () => void
  onAiProgress(cb: (p: AiProgressPayload) => void): () => void
  onPose(cb: (pose: IslandPose) => void): () => void
  onReceived(cb: (r: AddResult) => void): () => void
  onDecorChanged(cb: (d: DecorationState) => void): () => void
  onIslandMemoryChanged(cb: (m: IslandMemory) => void): () => void
  onFocusChanged(cb: (f: FocusState) => void): () => void
  onFocusFinished(cb: (phase: 'focus' | 'rest') => void): () => void
  onOtterReact(cb: (r: OtterReactionPayload) => void): () => void
  onSettingsChanged(cb: (s: Settings) => void): () => void
  onDragEnded(cb: () => void): () => void
  onPanelPinnedChanged(cb: (pinned: boolean) => void): () => void
}
