import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusController } from './focusTimer'
import { Store } from './store'

const dirs: string[] = []

function makeStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), 'pocket-isle-focus-'))
  dirs.push(dir)
  return new Store(dir)
}

afterEach(() => {
  vi.useRealTimers()
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

describe('FocusController custom durations & completion', () => {
  it('支持自定义专注时长（最高 180 分钟）与设置持久化时长同步', () => {
    const store = makeStore()
    const ctrl = new FocusController(
      store,
      () => {},
      () => {}
    )

    store.update((d) => {
      d.settings.focusMinutes = 45
      d.settings.restMinutes = 10
    })
    ctrl.syncIdleDuration()
    expect(ctrl.state.totalMs).toBe(45 * 60 * 1000)
    expect(ctrl.state.remainingMs).toBe(45 * 60 * 1000)

    ctrl.control('start_focus', 150)
    expect(ctrl.state.phase).toBe('focus')
    expect(ctrl.state.totalMs).toBe(150 * 60 * 1000)

    ctrl.control('reset')
    expect(ctrl.state.phase).toBe('idle')
    expect(ctrl.state.totalMs).toBe(45 * 60 * 1000)

    ctrl.control('start_rest')
    expect(ctrl.state.phase).toBe('rest')
    expect(ctrl.state.totalMs).toBe(10 * 60 * 1000)

    ctrl.dispose()
  })

  it('倒计时结束触发 onFinished 回调并进入 focus_done / idle', () => {
    vi.useFakeTimers()
    const store = makeStore()
    const finished: Array<'focus' | 'rest'> = []
    const ctrl = new FocusController(
      store,
      () => {},
      () => {},
      (phase) => finished.push(phase)
    )

    ctrl.control('start_focus', 1)
    vi.advanceTimersByTime(61 * 1000)
    expect(ctrl.state.phase).toBe('focus_done')
    expect(ctrl.state.running).toBe(false)
    expect(finished).toEqual(['focus'])

    ctrl.control('start_rest', 1)
    vi.advanceTimersByTime(61 * 1000)
    expect(ctrl.state.phase).toBe('idle')
    expect(finished).toEqual(['focus', 'rest'])

    ctrl.dispose()
  })
})
