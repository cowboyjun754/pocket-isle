/** 主进程、preload、渲染进程共用的类型（v3：自由桌搭 + 减压互动 + 专注计时 + AI 水獭搭档） */

import type { DockSide, ExpandMode } from './shape'

export type DecorationId = 'flowers' | 'bench' | 'lamp' | 'tree' | 'cabin' | 'windmill'
export type OtterAction = 'idle' | 'receive' | 'read' | 'wave' | 'rest'
export type AmbienceMode = 'day' | 'night' | 'rain'
export type ParcelKind = 'envelope' | 'box' | 'scroll'

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
  /** 显示名称（原文件名） */
  name: string
  /** 小写扩展名，不含点 */
  ext: string
  /** 实际使用的路径：只存路径的条目 = 原路径；副本条目 = 应用目录里的副本 */
  path: string
  /** 拖入时的原始路径 */
  sourcePath: string
  /** 是否为自动复制的副本 */
  isCopy: boolean
  /** 是否为文件夹引用 */
  isDir?: boolean
  size: number
  mtimeMs: number
  addedAt: number
  /** 应用内分组名（仅调整应用内组织，不改磁盘原文件） */
  group?: string
  /** AI 文件速览结果 */
  summary?: FileSummary
  /** 运行时检查结果，不持久化 */
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
  /** 留空且 clearApiKey!==true 时沿用当前源已存密钥；非空则更新密钥 */
  apiKey?: string
  /** 显式清除当前源已保存的密钥 */
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
  /** 副本总容量上限（MB） */
  copyLimitMB: number
  /** 默认专注时长（分钟，1..180） */
  focusMinutes?: number
  /** 默认休息时长（分钟，1..60） */
  restMinutes?: number
  /** 专注/休息结束时提示音与桌面通知 */
  focusNotify?: boolean
  ai: AiConfig
}

export type SettingsPatch = Partial<
  Pick<
    Settings,
    'alwaysOnTop' | 'openAtLogin' | 'copyLimitMB' | 'focusMinutes' | 'restMinutes' | 'focusNotify'
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
  message: string
  otterBubble?: string
}

export interface AiBreakdownResult {
  ok: boolean
  cancelled?: boolean
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
  /** 返回空字符串表示成功，否则为错误信息 */
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

  // 自由桌搭与小岛记忆
  getDecorations(): Promise<DecorationState>
  setDecorations(next: Partial<DecorationState>): Promise<DecorationState>
  getIslandMemory(): Promise<IslandMemory>
  setIslandMemory(patch: Partial<IslandMemory>): Promise<IslandMemory>

  // 专注计时与目标拆解
  getFocus(): Promise<FocusState>
  focusControl(
    action: 'start_focus' | 'pause' | 'resume' | 'start_rest' | 'reset',
    durationMinutes?: number
  ): Promise<FocusState>
  updateFocusPlan(goal: string, steps: FocusStep[]): Promise<FocusState>

  // AI 水獭搭档与设置
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
  ): Promise<{ ok: boolean; cancelled?: boolean; message: string }>
  cancelAi(): void

  // 事件订阅
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
