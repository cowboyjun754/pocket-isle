import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  COPY_LIMIT_MAX_MB,
  COPY_LIMIT_MIN_MB,
  FOCUS_MAX_MINUTES,
  FOCUS_MIN_MINUTES,
  REST_MAX_MINUTES,
  REST_MIN_MINUTES
} from './settingsRules'
import { Store } from './store'

const dirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

describe('Store recovery & summary sanitization', () => {
  it('sanitizes malformed summary fields when loading persisted data', () => {
    const dir = makeTempDir('pocket-isle-store-')
    writeFileSync(
      join(dir, 'data.json'),
      JSON.stringify({
        version: 2,
        items: [
          {
            id: 'a',
            name: 'test.md',
            ext: 'md',
            path: 'C:\\docs\\test.md',
            sourcePath: 'C:\\docs\\test.md',
            isCopy: false,
            size: 10,
            mtimeMs: 0,
            addedAt: 0,
            summary: {
              brief: { bad: 'obj' },
              bullets: ['正常要点', { bad: 2 }],
              attention: 12345,
              readStatus: 'unknown-status',
              updatedAt: 'not-number'
            }
          }
        ]
      }),
      'utf8'
    )

    const store = new Store(dir)
    const s = store.data.items[0].summary
    expect(typeof s?.brief).toBe('string')
    expect(s?.brief).toBe('暂无简介')
    expect(s?.bullets).toEqual(['正常要点'])
    expect(s?.attention).toBe('12345')
    expect(s?.readStatus).toBe('meta-only')
    expect(typeof s?.updatedAt).toBe('number')
    store.dispose()
  })

  it('retains dirty flag and notifies callback on saveNow failure, recovering after permissions return', () => {
    const dir = makeTempDir('pocket-isle-store-err-')
    const store = new Store(dir)
    // Create a blocking directory named data.json.tmp to simulate write failure
    const blockingTmpDir = join(dir, 'data.json.tmp')
    mkdirSync(blockingTmpDir)

    let errorNotified = false
    const storeWithCb = new Store(dir, {
      onSaveError: () => {
        errorNotified = true
      }
    })
    storeWithCb.update((d) => {
      d.dockSide = 'left'
    })
    const ok1 = storeWithCb.saveNow()
    expect(ok1).toBe(false)
    expect(storeWithCb.isDirty()).toBe(true)
    expect(errorNotified).toBe(true)

    rmSync(blockingTmpDir, { recursive: true, force: true })
    const ok2 = storeWithCb.saveNow()
    expect(ok2).toBe(true)
    expect(storeWithCb.isDirty()).toBe(false)
    expect(existsSync(join(dir, 'data.json'))).toBe(true)
    expect(readFileSync(join(dir, 'data.json'), 'utf8')).toContain('"dockSide": "left"')
    store.dispose()
    storeWithCb.dispose()
  })

  it('clamps out-of-range numeric settings and falls back on invalid values on load', () => {
    const lowDir = makeTempDir('pocket-isle-store-low-')
    writeFileSync(
      join(lowDir, 'data.json'),
      JSON.stringify({
        version: 2,
        settings: { copyLimitMB: 8, focusMinutes: 0, restMinutes: -3 }
      }),
      'utf8'
    )
    const lowStore = new Store(lowDir)
    expect(lowStore.data.settings.copyLimitMB).toBe(COPY_LIMIT_MIN_MB)
    expect(lowStore.data.settings.focusMinutes).toBe(FOCUS_MIN_MINUTES)
    expect(lowStore.data.settings.restMinutes).toBe(REST_MIN_MINUTES)
    lowStore.dispose()

    const highDir = makeTempDir('pocket-isle-store-high-')
    writeFileSync(
      join(highDir, 'data.json'),
      JSON.stringify({
        version: 2,
        settings: { copyLimitMB: 99999, focusMinutes: 240.4, restMinutes: 90 }
      }),
      'utf8'
    )
    const highStore = new Store(highDir)
    expect(highStore.data.settings.copyLimitMB).toBe(COPY_LIMIT_MAX_MB)
    expect(highStore.data.settings.focusMinutes).toBe(FOCUS_MAX_MINUTES)
    expect(highStore.data.settings.restMinutes).toBe(REST_MAX_MINUTES)
    highStore.dispose()

    const invalidDir = makeTempDir('pocket-isle-store-invalid-')
    writeFileSync(
      join(invalidDir, 'data.json'),
      JSON.stringify({
        version: 2,
        settings: { copyLimitMB: 'bad', focusMinutes: null, restMinutes: 'NaN' }
      }),
      'utf8'
    )
    const invalidStore = new Store(invalidDir)
    expect(invalidStore.data.settings.copyLimitMB).toBe(2048)
    expect(invalidStore.data.settings.focusMinutes).toBe(25)
    expect(invalidStore.data.settings.restMinutes).toBe(5)
    invalidStore.dispose()

    const roundDir = makeTempDir('pocket-isle-store-round-')
    writeFileSync(
      join(roundDir, 'data.json'),
      JSON.stringify({
        version: 2,
        settings: { copyLimitMB: 512.7, focusMinutes: 29.6, restMinutes: 7.2 }
      }),
      'utf8'
    )
    const roundStore = new Store(roundDir)
    expect(roundStore.data.settings.copyLimitMB).toBe(513)
    expect(roundStore.data.settings.focusMinutes).toBe(30)
    expect(roundStore.data.settings.restMinutes).toBe(7)
    roundStore.dispose()
  })
})
