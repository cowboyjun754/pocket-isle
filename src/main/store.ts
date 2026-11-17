import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DockSide } from '../shared/shape'
import type {
  DecorationState,
  DockItem,
  FocusState,
  IslandMemory,
  IslandSprout,
  Settings
} from '../shared/types'

export interface Data {
  version: 2
  items: DockItem[]
  settings: Settings
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
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    enableVision: false
  }
}

const DEFAULT_DATA: Data = {
  version: 2,
  items: [],
  settings: DEFAULT_SETTINGS,
  decorations: DEFAULT_DECORATIONS,
  islandMemory: DEFAULT_ISLAND_MEMORY,
  focus: DEFAULT_FOCUS,
  dockSide: 'right'
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

/** 简单 JSON 持久化：先写临时文件再改名替换，防止写到一半断电导致文件损坏；平滑迁移 v1 数据 */
export class Store {
  data: Data
  private file: string
  private timer: NodeJS.Timeout | null = null

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'data.json')
    this.data = this.load()
  }

  private load(): Data {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Data>
        const savedFocus = raw.focus ?? DEFAULT_FOCUS
        return {
          ...DEFAULT_DATA,
          ...raw,
          items: Array.isArray(raw.items) ? raw.items : [],
          settings: {
            ...DEFAULT_SETTINGS,
            ...(raw.settings ?? {}),
            ai: {
              ...DEFAULT_SETTINGS.ai,
              ...(raw.settings?.ai ?? {})
            }
          },
          decorations: {
            ambience: raw.decorations?.ambience === 'night' ? 'night' : 'day',
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
          // 重启应用时若有未走完的计时，以暂停状态恢复，不跨关机乱累计时长
          focus: {
            ...DEFAULT_FOCUS,
            ...savedFocus,
            running: false,
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
    this.scheduleSave()
  }

  scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.saveNow(), 200)
  }

  saveNow(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const items = this.data.items.map(({ available: _a, ...rest }) => rest)
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify({ ...this.data, items }, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }
}
