import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL } from '../shared/aiProvider'
import { DEFAULT_LOCALE, getMessages, resolveLocale } from '../shared/i18n'
import type { DockSide } from '../shared/shape'
import type {
  AppLocale,
  DecorationState,
  DockItem,
  FocusState,
  IslandMemory,
  IslandSprout,
  Settings
} from '../shared/types'
import {
  COPY_LIMIT_MAX_MB,
  COPY_LIMIT_MIN_MB,
  FOCUS_MAX_MINUTES,
  FOCUS_MIN_MINUTES,
  REST_MAX_MINUTES,
  REST_MIN_MINUTES
} from './settingsRules'
import { sanitizeFileSummary } from './summaryGuard'

export interface Data {
  version: 2
  items: DockItem[]
  pendingDeletes?: string[]
  settings: Settings
  aiSecrets?: Record<string, string>
  decorations: DecorationState
  islandMemory: IslandMemory
  focus: FocusState
  islandPos?: { x: number; y: number }
  dockSide?: DockSide
}

export const DEFAULT_ISLAND_MEMORY: IslandMemory = {
  sprouts: [
    { id: 1, x: 184, y: 142, kind: 0 },
    { id: 2, x: 256, y: 122, kind: 1 },
    { id: 3, x: 148, y: 120, kind: 2 }
  ],
  lampLit: null,
  cabinWarm: null
}

const DEFAULT_DECORATIONS: DecorationState = {
  enabled: {
    flowers: true,
    bench: true,
    lamp: true,
    tree: true,
    cabin: true,
    windmill: true
  },
  ambience: 'day'
}

const DEFAULT_FOCUS: FocusState = {
  phase: 'idle',
  running: false,
  remainingMs: 25 * 60 * 1000,
  totalMs: 25 * 60 * 1000,
  goal: '',
  steps: []
}

const DEFAULT_SETTINGS: Settings = {
  alwaysOnTop: true,
  openAtLogin: false,
  copyLimitMB: 2048,
  focusMinutes: 25,
  restMinutes: 5,
  focusNotify: true,
  locale: DEFAULT_LOCALE,
  ai: {
    baseUrl: DEFAULT_AI_BASE_URL,
    model: DEFAULT_AI_MODEL,
    enableVision: false
  }
}

const DEFAULT_DATA: Data = {
  version: 2,
  items: [],
  pendingDeletes: [],
  settings: DEFAULT_SETTINGS,
  aiSecrets: {},
  decorations: DEFAULT_DECORATIONS,
  islandMemory: DEFAULT_ISLAND_MEMORY,
  focus: DEFAULT_FOCUS,
  dockSide: 'right'
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeSprouts(raw: unknown): IslandSprout[] {
  if (!Array.isArray(raw)) return structuredClone(DEFAULT_ISLAND_MEMORY.sprouts)
  const valid = raw
    .filter(
      (s): s is IslandSprout =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as IslandSprout).id === 'number' &&
        Number.isFinite((s as IslandSprout).x) &&
        Number.isFinite((s as IslandSprout).y) &&
        ((s as IslandSprout).kind === 0 ||
          (s as IslandSprout).kind === 1 ||
          (s as IslandSprout).kind === 2)
    )
    .slice(-8)
  return valid
}

/** Atomic JSON persistence: writes to temp file before rename, preserves dirty flag and retries on failure. */
export class Store {
  data: Data
  private file: string
  private timer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private dirty = false
  private lastSaveError: string | null = null
  private onSaveError?: (msg: string) => void
  private getLocale: () => AppLocale
  private legacyAiKey: { baseUrl: string; apiKey: string } | null = null

  constructor(
    dir: string,
    opts?: { onSaveError?: (msg: string) => void; getLocale?: () => AppLocale }
  ) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'data.json')
    this.onSaveError = opts?.onSaveError
    this.getLocale = opts?.getLocale ?? (() => DEFAULT_LOCALE)
    this.data = this.load()
  }

  getLastSaveError(): string | null {
    return this.lastSaveError
  }

  isDirty(): boolean {
    return this.dirty
  }

  consumeLegacyAiKey(): { baseUrl: string; apiKey: string } | null {
    const k = this.legacyAiKey
    this.legacyAiKey = null
    return k
  }

  private load(): Data {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Data> & {
          settings?: Partial<Settings> & { ai?: Record<string, unknown> }
        }
        const savedFocus = raw.focus ?? DEFAULT_FOCUS
        const rawAi = raw.settings?.ai
        const rawLegacyKey = typeof rawAi?.apiKey === 'string' ? rawAi.apiKey.trim() : ''
        const aiBaseUrl =
          typeof rawAi?.baseUrl === 'string' && rawAi.baseUrl.trim()
            ? rawAi.baseUrl.trim()
            : DEFAULT_SETTINGS.ai.baseUrl
        if (rawLegacyKey) {
          this.legacyAiKey = { baseUrl: aiBaseUrl, apiKey: rawLegacyKey }
        }
        const mergedSettings: Settings = {
          ...DEFAULT_SETTINGS,
          ...(raw.settings ?? {}),
          ai: {
            baseUrl: aiBaseUrl,
            model:
              typeof rawAi?.model === 'string' && rawAi.model.trim()
                ? rawAi.model.trim()
                : DEFAULT_SETTINGS.ai.model,
            enableVision: !!rawAi?.enableVision
          }
        }
        const rawSecrets =
          raw.aiSecrets && typeof raw.aiSecrets === 'object' && !Array.isArray(raw.aiSecrets)
            ? Object.fromEntries(
                Object.entries(raw.aiSecrets).filter(
                  (kv): kv is [string, string] => typeof kv[0] === 'string' && typeof kv[1] === 'string'
                )
              )
            : {}
        const focusMin = clampInt(
          mergedSettings.focusMinutes,
          FOCUS_MIN_MINUTES,
          FOCUS_MAX_MINUTES,
          25
        )
        const restMin = clampInt(mergedSettings.restMinutes, REST_MIN_MINUTES, REST_MAX_MINUTES, 5)
        mergedSettings.copyLimitMB = clampInt(
          mergedSettings.copyLimitMB,
          COPY_LIMIT_MIN_MB,
          COPY_LIMIT_MAX_MB,
          DEFAULT_SETTINGS.copyLimitMB
        )
        mergedSettings.focusMinutes = focusMin
        mergedSettings.restMinutes = restMin
        mergedSettings.focusNotify =
          typeof mergedSettings.focusNotify === 'boolean' ? mergedSettings.focusNotify : true
        mergedSettings.locale = resolveLocale(mergedSettings.locale)
        const activeLocale = mergedSettings.locale
        const focusPhase = savedFocus.phase ?? 'idle'
        const focusMs = focusMin * 60 * 1000
        const safeItems: DockItem[] = Array.isArray(raw.items)
          ? raw.items
              .filter((it): it is DockItem => !!it && typeof it === 'object' && typeof it.id === 'string' && typeof it.path === 'string')
              .map((it) => {
                const summary = sanitizeFileSummary(
                  (it as unknown as { summary?: unknown }).summary,
                  activeLocale
                )
                const { summary: _old, available: _avail, ...rest } = it as DockItem & {
                  summary?: unknown
                }
                return summary ? { ...rest, summary } : rest
              })
          : []
        const safePendingDeletes = Array.isArray(raw.pendingDeletes)
          ? raw.pendingDeletes.filter((p): p is string => typeof p === 'string' && p.length > 0)
          : []
        return {
          ...DEFAULT_DATA,
          ...raw,
          items: safeItems,
          pendingDeletes: safePendingDeletes,
          settings: mergedSettings,
          aiSecrets: rawSecrets,
          decorations: {
            ambience:
              raw.decorations?.ambience === 'night' || raw.decorations?.ambience === 'rain'
                ? raw.decorations.ambience
                : 'day',
            enabled: {
              ...DEFAULT_DECORATIONS.enabled,
              ...(raw.decorations?.enabled ?? {})
            }
          },
          islandMemory: {
            sprouts: normalizeSprouts(raw.islandMemory?.sprouts),
            lampLit:
              typeof raw.islandMemory?.lampLit === 'boolean' ? raw.islandMemory.lampLit : null,
            cabinWarm:
              typeof raw.islandMemory?.cabinWarm === 'boolean' ? raw.islandMemory.cabinWarm : null
          },
          // Restore unfinished focus/rest timer as paused on restart rather than accumulating offline elapsed time
          focus: {
            ...DEFAULT_FOCUS,
            ...savedFocus,
            running: false,
            ...(focusPhase === 'idle' ? { remainingMs: focusMs, totalMs: focusMs } : {}),
            steps: Array.isArray(savedFocus.steps) ? savedFocus.steps : []
          },
          dockSide:
            raw.dockSide === 'left' || raw.dockSide === 'right' || raw.dockSide === 'free'
              ? raw.dockSide
              : 'right',
          version: 2
        }
      }
    } catch (err) {
      try {
        renameSync(this.file, this.file + '.broken-' + Date.now())
      } catch {
        /* ignore */
      }
      console.error('[store] load failed', err)
    }
    return structuredClone(DEFAULT_DATA)
  }

  update(fn: (d: Data) => void): void {
    fn(this.data)
    this.dirty = true
    this.scheduleSave()
  }

  scheduleSave(): void {
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.saveNow(), 200)
  }

  saveNow(): boolean {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    try {
      const items = this.data.items.map(({ available: _a, ...rest }) => rest)
      const tmp = this.file + '.tmp'
      writeFileSync(tmp, JSON.stringify({ ...this.data, items }, null, 2), 'utf8')
      renameSync(tmp, this.file)
      this.dirty = false
      this.lastSaveError = null
      return true
    } catch (err) {
      const m = getMessages(this.data?.settings?.locale ?? this.getLocale())
      const msg = (err as Error)?.message || m.main.storeWriteFailed
      const firstFail = this.lastSaveError === null
      this.lastSaveError = msg
      this.dirty = true
      console.error('[store] saveNow failed', err)
      if (firstFail) {
        this.onSaveError?.(m.main.storeSaveError(msg))
      }
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        if (this.dirty) this.saveNow()
      }, 3000)
      return false
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.dirty) this.saveNow()
  }
}
