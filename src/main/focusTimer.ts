import { randomUUID } from 'crypto'
import type { FocusState, FocusStep, OtterReactionPayload } from '../shared/types'
import type { Store } from './store'

const DEFAULT_FOCUS_MIN = 25
const DEFAULT_REST_MIN = 5
const CHECKPOINT_INTERVAL_MS = 15_000

/**
 * Independent focus & rest timer controller (v3):
 * - Computes elapsed time centrally from wall-clock `Date.now()` deltas in main process;
 * - Auto-pauses on screen lock / suspend and waits for resume;
 * - Saves lightweight checkpoints every 15s while running so crashes lose at most one interval;
 * - Emits gentle completion cues only without auto-checking user steps or gating decorations.
 */
export class FocusController {
  private ticker: NodeJS.Timeout | null = null
  private lastTickAt = 0
  private lastCheckpointAt = 0

  constructor(
    private store: Store,
    private onUpdate: (state: FocusState) => void,
    private onOtter: (react: OtterReactionPayload) => void,
    private onFinished?: (phase: 'focus' | 'rest') => void
  ) {}

  private configuredFocusMin(): number {
    const raw = this.store.data.settings.focusMinutes
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.min(Math.max(Math.round(raw), 1), 180)
    }
    return DEFAULT_FOCUS_MIN
  }

  private configuredRestMin(): number {
    const raw = this.store.data.settings.restMinutes
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.min(Math.max(Math.round(raw), 1), 60)
    }
    return DEFAULT_REST_MIN
  }

  get state(): FocusState {
    return this.store.data.focus
  }

  /** Syncs updated focus duration while the timer is idle. */
  syncIdleDuration(): void {
    const f = this.store.data.focus
    if (f.phase === 'idle' && !f.running) {
      const ms = this.configuredFocusMin() * 60 * 1000
      if (f.totalMs !== ms || f.remainingMs !== ms) {
        f.totalMs = ms
        f.remainingMs = ms
        this.store.scheduleSave()
        this.onUpdate(f)
      }
    }
  }

  control(
    action: 'start_focus' | 'pause' | 'resume' | 'start_rest' | 'reset',
    durationMinutes?: number
  ): FocusState {
    const f = this.store.data.focus
    if (action === 'start_focus') {
      const rawMin =
        typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes > 0
          ? durationMinutes
          : this.configuredFocusMin()
      const mins = Math.min(Math.max(Math.round(rawMin), 1), 180)
      const ms = mins * 60 * 1000
      f.phase = 'focus'
      f.totalMs = ms
      f.remainingMs = ms
      f.running = true
      this.startTicker()
      this.onOtter({ action: 'read', bubble: `开始 ${mins} 分钟专注，我陪你~`, durationMs: 3200 })
    } else if (action === 'pause') {
      this.syncElapsed()
      f.running = false
      this.stopTicker()
    } else if (action === 'resume') {
      if (f.phase === 'focus' || f.phase === 'rest') {
        f.running = true
        this.startTicker()
      }
    } else if (action === 'start_rest') {
      const rawMin =
        typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes > 0
          ? durationMinutes
          : this.configuredRestMin()
      const mins = Math.min(Math.max(Math.round(rawMin), 1), 60)
      const ms = mins * 60 * 1000
      f.phase = 'rest'
      f.totalMs = ms
      f.remainingMs = ms
      f.running = true
      this.startTicker()
      this.onOtter({ action: 'rest', bubble: `伸个懒腰，休息 ${mins} 分钟吧~`, durationMs: 4000 })
    } else if (action === 'reset') {
      this.stopTicker()
      const rawMin =
        typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes > 0
          ? durationMinutes
          : this.configuredFocusMin()
      const mins = Math.min(Math.max(Math.round(rawMin), 1), 180)
      f.phase = 'idle'
      f.running = false
      f.totalMs = mins * 60 * 1000
      f.remainingMs = f.totalMs
      this.onOtter({ action: 'idle' })
    }
    this.store.scheduleSave()
    this.onUpdate(f)
    return f
  }

  updatePlan(goal: string, steps: FocusStep[]): FocusState {
    const f = this.store.data.focus
    f.goal = goal
    f.steps = steps.map((s) => ({
      id: s.id || randomUUID(),
      text: s.text,
      done: !!s.done
    }))
    this.store.scheduleSave()
    this.onUpdate(f)
    return f
  }

  pauseForSystemSuspend(): void {
    if (this.state.running) {
      this.control('pause')
    }
  }

  dispose(): void {
    this.stopTicker()
  }

  private startTicker(): void {
    this.stopTicker()
    const now = Date.now()
    this.lastTickAt = now
    this.lastCheckpointAt = now
    this.ticker = setInterval(() => this.tick(), 1000)
  }

  private stopTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
  }

  private syncElapsed(): void {
    const f = this.store.data.focus
    if (!f.running) return
    const now = Date.now()
    const dt = Math.max(0, now - this.lastTickAt)
    this.lastTickAt = now
    f.remainingMs = Math.max(0, f.remainingMs - dt)
  }

  private tick(): void {
    this.syncElapsed()
    const f = this.store.data.focus
    if (f.remainingMs <= 0) {
      this.stopTicker()
      f.running = false
      if (f.phase === 'focus') {
        f.phase = 'focus_done'
        this.onOtter({
          action: 'wave',
          bubble: '本轮专注结束啦，喝口水歇会儿~',
          durationMs: 5000
        })
        this.onFinished?.('focus')
      } else {
        f.phase = 'idle'
        f.totalMs = this.configuredFocusMin() * 60 * 1000
        f.remainingMs = f.totalMs
        this.onOtter({
          action: 'wave',
          bubble: '休息完毕，随时可以继续~',
          durationMs: 4000
        })
        this.onFinished?.('rest')
      }
      this.store.scheduleSave()
    } else if (Date.now() - this.lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
      this.lastCheckpointAt = Date.now()
      this.store.scheduleSave()
    }
    this.onUpdate(f)
  }
}
