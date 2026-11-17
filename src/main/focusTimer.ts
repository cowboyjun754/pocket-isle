import { randomUUID } from 'crypto'
import type { FocusState, FocusStep, OtterReactionPayload } from '../shared/types'
import type { Store } from './store'

const DEFAULT_FOCUS_MIN = 25
const DEFAULT_REST_MIN = 5

/**
 * 独立专注与休息计时器（v3）：
 * - 按真实经过的时间（Date.now() 差值）在主进程统一计算；
 * - 锁屏或休眠时自动暂停，恢复后等待用户继续；
 * - 计时结束只提示本轮结束，不自动把任务步骤标为已完成，也不与装饰解锁挂钩。
 */
export class FocusController {
  private ticker: NodeJS.Timeout | null = null
  private lastTickAt = 0

  constructor(
    private store: Store,
    private onUpdate: (state: FocusState) => void,
    private onOtter: (react: OtterReactionPayload) => void
  ) {}

  get state(): FocusState {
    return this.store.data.focus
  }

  control(
    action: 'start_focus' | 'pause' | 'resume' | 'start_rest' | 'reset',
    durationMinutes?: number
  ): FocusState {
    const f = this.store.data.focus
    if (action === 'start_focus') {
      const mins = Math.min(Math.max(durationMinutes || DEFAULT_FOCUS_MIN, 1), 120)
      const ms = mins * 60 * 1000
      f.phase = 'focus'
      f.totalMs = ms
      f.remainingMs = ms
      f.running = true
      this.startTicker()
      this.onOtter({ action: 'read', bubble: '开始专注，我陪你一起~', durationMs: 3200 })
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
      const mins = Math.min(Math.max(durationMinutes || DEFAULT_REST_MIN, 1), 60)
      const ms = mins * 60 * 1000
      f.phase = 'rest'
      f.totalMs = ms
      f.remainingMs = ms
      f.running = true
      this.startTicker()
      this.onOtter({ action: 'rest', bubble: '伸个懒腰，休息一下吧~', durationMs: 4000 })
    } else if (action === 'reset') {
      this.stopTicker()
      f.phase = 'idle'
      f.running = false
      f.totalMs = DEFAULT_FOCUS_MIN * 60 * 1000
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
    this.lastTickAt = Date.now()
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
      } else {
        f.phase = 'idle'
        f.totalMs = DEFAULT_FOCUS_MIN * 60 * 1000
        f.remainingMs = f.totalMs
        this.onOtter({
          action: 'wave',
          bubble: '休息完毕，随时可以继续~',
          durationMs: 4000
        })
      }
      this.store.scheduleSave()
    }
    this.onUpdate(f)
  }
}
