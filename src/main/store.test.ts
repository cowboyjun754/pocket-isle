import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
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
})
