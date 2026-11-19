import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Dock } from './dock'
import { Store } from './store'

const dirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Dock.add deduplication', () => {
  it('skips duplicate staging when re-dropping internal copy paths to avoid self-copy or dangling refs', async () => {
    const dataDir = makeTempDir('pocket-isle-data-')
    const tempDir = makeTempDir('pocket-isle-temp-')
    const normalDir = makeTempDir('pocket-isle-src-')

    const store = new Store(dataDir)
    const dock = new Dock(store, join(dataDir, 'dock-copies'), [tempDir], join(dataDir, 'drop.log'))

    const tempFile = join(tempDir, 'wechat-shot.png')
    writeFileSync(tempFile, Buffer.from('fake-png'))
    const first = await dock.add([tempFile])
    expect(first.added).toBe(1)
    expect(dock.items).toHaveLength(1)
    expect(dock.items[0].isCopy).toBe(true)

    // Re-dropping a copy dragged out from the dock must recognize it as already staged
    const reDropCopy = await dock.add([dock.items[0].path])
    expect(reDropCopy.added).toBe(0)
    expect(reDropCopy.skipped).toBe(1)
    expect(dock.items).toHaveLength(1)

    // Clipboard copy paths must likewise not be duplicated on re-drop
    const clipRes = await dock.addBufferItem('note.txt', Buffer.from('hello'), 'clipboard://text')
    expect(clipRes.added).toBe(1)
    const clipItem = dock.items.find((i) => i.sourcePath === 'clipboard://text')!
    const reDropClip = await dock.add([clipItem.path])
    expect(reDropClip.added).toBe(0)
    expect(reDropClip.skipped).toBe(1)
    expect(dock.items).toHaveLength(2)

    // Re-dropping regular disk files skips duplicates normally
    const normalFile = join(normalDir, 'doc.md')
    writeFileSync(normalFile, 'readme')
    expect((await dock.add([normalFile])).added).toBe(1)
    expect((await dock.add([normalFile])).skipped).toBe(1)
    expect(dock.items).toHaveLength(3)
  })

  it('supports staging folder shortcuts without copying contents and marks unavailable after deletion', async () => {
    const dataDir = makeTempDir('pocket-isle-data-')
    const tempDir = makeTempDir('pocket-isle-temp-')
    const folder = join(tempDir, 'project-notes')
    mkdirSync(folder)

    const store = new Store(dataDir)
    const dock = new Dock(store, join(dataDir, 'dock-copies'), [tempDir], join(dataDir, 'drop.log'))

    const first = await dock.add([folder])
    expect(first.added).toBe(1)
    expect(dock.items[0].isDir).toBe(true)
    expect(dock.items[0].ext).toBe('dir')
    expect(dock.items[0].isCopy).toBe(false)

    // Duplicate folder drops are skipped
    const second = await dock.add([folder])
    expect(second.skipped).toBe(1)

    // Once source folder disappears, listWithStatus() reports available: false
    rmSync(folder, { recursive: true, force: true })
    const listed = await dock.listWithStatus()
    expect(listed[0].available).toBe(false)
  })
})

describe('Dock concurrency, quota & short-time undo', () => {
  it('strictly deduplicates concurrent imports of the same temp file into one entry and one copy', async () => {
    const dataDir = makeTempDir('pocket-isle-data-')
    const tempDir = makeTempDir('pocket-isle-temp-')
    const store = new Store(dataDir)
    const dock = new Dock(store, join(dataDir, 'dock-copies'), [tempDir], join(dataDir, 'drop.log'))

    const tempFile = join(tempDir, 'lecture.pdf')
    writeFileSync(tempFile, Buffer.from('pdf-bytes'))

    const [r1, r2] = await Promise.all([dock.add([tempFile]), dock.add([tempFile])])
    expect(r1.added + r2.added).toBe(1)
    expect(r1.skipped + r2.skipped).toBe(1)
    expect(dock.items).toHaveLength(1)
  })

  it('prevents concurrent clipboard writes from exceeding copyLimitMB quota', async () => {
    const dataDir = makeTempDir('pocket-isle-data-')
    const store = new Store(dataDir)
    store.data.settings.copyLimitMB = 64
    const dock = new Dock(store, join(dataDir, 'dock-copies'), [], join(dataDir, 'drop.log'))

    const bufA = Buffer.alloc(33 * 1024 * 1024, 1)
    const bufB = Buffer.alloc(33 * 1024 * 1024, 2)

    const [r1, r2] = await Promise.all([
      dock.addBufferItem('shot-a.png', bufA, 'clipboard://image'),
      dock.addBufferItem('shot-b.png', bufB, 'clipboard://image')
    ])

    expect(r1.added + r2.added).toBe(1)
    expect(r1.errors.length + r2.errors.length).toBe(1)
    expect(dock.items).toHaveLength(1)
    expect(dock.copyUsage()).toBeLessThanOrEqual(64 * 1024 * 1024)
  })

  it('retains removed clipboard copy during undo window and deletes only on purge or space reclamation', async () => {
    const dataDir = makeTempDir('pocket-isle-data-')
    const store = new Store(dataDir)
    store.data.settings.copyLimitMB = 64
    const dock = new Dock(store, join(dataDir, 'dock-copies'), [], join(dataDir, 'drop.log'), {
      undoTtlMs: 10_000
    })

    await dock.addBufferItem('shot.png', Buffer.from('png-data-123'), 'clipboard://image')
    const item = dock.items[0]
    expect(existsSync(item.path)).toBe(true)

    await dock.remove([item.id])
    expect(dock.items).toHaveLength(0)
    expect(dock.hasActiveUndo()).toBe(true)
    // Disk copy remains intact during the undo grace window
    expect(existsSync(item.path)).toBe(true)

    const undoRes = await dock.undoRemove()
    expect(undoRes.ok).toBe(true)
    expect(undoRes.restored).toBe(1)
    expect(dock.items).toHaveLength(1)
    expect(dock.items[0].id).toBe(item.id)
    expect(existsSync(item.path)).toBe(true)

    // Exiting / flushing pending deletes cleans physical copies in undo buffer
    await dock.clear()
    expect(dock.items).toHaveLength(0)
    dock.flushPendingDeletesSync()
    expect(existsSync(item.path)).toBe(false)
    expect((await dock.undoRemove()).ok).toBe(false)
  })

  it('dismissUndo purges active undo batch, cleans copies, and ignores mismatched tokens', async () => {
    const dataDir = makeTempDir('pocket-isle-data-')
    const store = new Store(dataDir)
    const undoEvents: Array<string | null> = []
    const dock = new Dock(store, join(dataDir, 'dock-copies'), [], join(dataDir, 'drop.log'), {
      undoTtlMs: 10_000,
      onUndoChanged: (u) => undoEvents.push(u ? u.token : null)
    })

    await dock.addBufferItem('note.txt', Buffer.from('hello'), 'clipboard://text')
    const item = dock.items[0]
    await dock.remove([item.id])

    const active = dock.getUndoState()
    expect(active).not.toBeNull()
    expect(existsSync(item.path)).toBe(true)

    // Mismatched token must not dismiss the current undo window
    await dock.dismissUndo('wrong-token')
    expect(dock.hasActiveUndo()).toBe(true)
    expect(existsSync(item.path)).toBe(true)

    // Matching token clears undo state, emits null, and deletes the buffered copy
    await dock.dismissUndo(active!.token)
    expect(dock.hasActiveUndo()).toBe(false)
    expect(dock.getUndoState()).toBeNull()
    expect(existsSync(item.path)).toBe(false)
    expect(undoEvents).toEqual([active!.token, null])
  })

  it('evicts undo buffer copies automatically when space is needed for new writes', async () => {
    const dataDir = makeTempDir('pocket-isle-data-')
    const store = new Store(dataDir)
    store.data.settings.copyLimitMB = 64
    const dock = new Dock(store, join(dataDir, 'dock-copies'), [], join(dataDir, 'drop.log'))

    await dock.addBufferItem('big1.bin', Buffer.alloc(40 * 1024 * 1024, 1), 'clipboard://text')
    const oldCopyPath = dock.items[0].path
    await dock.clear()
    expect(existsSync(oldCopyPath)).toBe(true)

    // Writing 35 MiB (active 0 + 35 <= 64, but + 40 undo > 64) evicts the old undo copy
    const res = await dock.addBufferItem(
      'big2.bin',
      Buffer.alloc(35 * 1024 * 1024, 2),
      'clipboard://text'
    )
    expect(res.added).toBe(1)
    expect(existsSync(oldCopyPath)).toBe(false)
    expect(dock.hasActiveUndo()).toBe(false)
  })

  it('records tombstones on failed copy deletion, cleans on retry, and omits drop-log.txt by default', async () => {
    const dataDir = makeTempDir('pocket-isle-data-')
    const tempDir = makeTempDir('pocket-isle-temp-')
    const copiesRoot = join(dataDir, 'dock-copies')
    const logPath = join(dataDir, 'drop-log.txt')
    const store = new Store(dataDir)

    let blockDelete = true
    const dock = new Dock(store, copiesRoot, [tempDir], logPath, {
      removeDir: async (dir) => {
        if (blockDelete) throw new Error('EBUSY: locked')
        rmSync(dir, { recursive: true, force: true })
      }
    })

    const f = join(tempDir, 'temp.bin')
    writeFileSync(f, Buffer.alloc(1024 * 1024, 3))
    await dock.add([f])
    expect(existsSync(logPath)).toBe(false)

    const copyDir = dirname(dock.items[0].path)
    await dock.clear()
    dock.flushPendingDeletesSync()
    // First attempt while removeDir is locked: prepare purgeUndoBatch failure via second item
    await dock.add([f])
    const lockedPath = dock.items[0].path
    const lockedDir = dirname(lockedPath)
    await dock.remove([dock.items[0].id])
    // Insert another item and remove to force purging previous batch into mocked throwing removeDir
    const f2 = join(tempDir, 'temp2.bin')
    writeFileSync(f2, Buffer.from('small'))
    await dock.add([f2])
    await dock.remove([dock.items[0].id])

    expect(existsSync(lockedDir)).toBe(true)
    expect(store.data.pendingDeletes).toContain(lockedDir)
    expect(dock.copyUsage()).toBe(1024 * 1024)

    // Unlock and call reconcileCopies along with an orphan dir and legacy drop-log.txt to test startup sweep
    blockDelete = false
    const orphanDir = join(copiesRoot, 'orphan-dir-123')
    mkdirSync(orphanDir, { recursive: true })
    writeFileSync(join(orphanDir, 'stale.txt'), 'old')
    writeFileSync(logPath, 'old-secret-path')

    await dock.reconcileCopies()
    expect(existsSync(lockedDir)).toBe(false)
    expect(existsSync(orphanDir)).toBe(false)
    expect(existsSync(logPath)).toBe(false)
    expect(store.data.pendingDeletes).toEqual([])
    expect(dock.copyUsage()).toBe(0)
    expect(copyDir.length).toBeGreaterThan(0)
  })
})
