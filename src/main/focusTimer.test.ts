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
  it('supports custom focus durations up to 180 min synced with settings', () => {
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

  it('fires onFinished callback on countdown completion and transitions to focus_done / idle', () => {
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

  it('writes lightweight checkpoints every 15s while running so crashes lose at most 15s', () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'pocket-isle-focus-ckpt-'))
    dirs.push(dir)
    const store = new Store(dir)
    const ctrl = new FocusController(
      store,
      () => {},
      () => {}
    )

    ctrl.control('start_focus', 5)
    vi.advanceTimersByTime(16 * 1000) // triggers 15s checkpoint + 200ms debounced flush
    ctrl.dispose()

    // Simulate abrupt restart reloading data.json directly (restored in paused state)
    const reloaded = new Store(dir)
    expect(reloaded.data.focus.phase).toBe('focus')
    expect(reloaded.data.focus.running).toBe(false)
    expect(reloaded.data.focus.remainingMs).toBeLessThanOrEqual(5 * 60 * 1000 - 15 * 1000)
    expect(reloaded.data.focus.remainingMs).toBeGreaterThan(5 * 60 * 1000 - 20 * 1000)
    reloaded.dispose()
    store.dispose()
  })
})
