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
  it('拖回应用内副本路径时跳过重复暂存，避免自复制或产生悬空引用', async () => {
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

    // 拖出副本路径再拖回面板/小岛时应识别为已存在条目
    const reDropCopy = await dock.add([dock.items[0].path])
    expect(reDropCopy.added).toBe(0)
    expect(reDropCopy.skipped).toBe(1)
    expect(dock.items).toHaveLength(1)

    // 剪贴板写入的副本路径同样不应重复添加
    const clipRes = await dock.addBufferItem('note.txt', Buffer.from('hello'), 'clipboard://text')
    expect(clipRes.added).toBe(1)
    const clipItem = dock.items.find((i) => i.sourcePath === 'clipboard://text')!
    const reDropClip = await dock.add([clipItem.path])
    expect(reDropClip.added).toBe(0)
    expect(reDropClip.skipped).toBe(1)
    expect(dock.items).toHaveLength(2)

    // 普通磁盘文件重复拖入也应正常跳过
    const normalFile = join(normalDir, 'doc.md')
    writeFileSync(normalFile, 'readme')
    expect((await dock.add([normalFile])).added).toBe(1)
    expect((await dock.add([normalFile])).skipped).toBe(1)
    expect(dock.items).toHaveLength(3)
  })

  it('支持暂存文件夹作为快捷引用且不复制目录内容，失效后标记为 unavailable', async () => {
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

    // 同一文件夹重复拖入跳过
    const second = await dock.add([folder])
    expect(second.skipped).toBe(1)

    // 原文件夹删除后 listWithStatus() 返回 available: false
    rmSync(folder, { recursive: true, force: true })
    const listed = await dock.listWithStatus()
    expect(listed[0].available).toBe(false)
  })
})

describe('Dock concurrency, quota & short-time undo', () => {
  it('并发导入同一临时文件时严格去重，仅保留一条记录与一份副本', async () => {
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

  it('并发写入剪贴板副本不会突破 copyLimitMB 配额上限', async () => {
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

  it('移除剪贴板副本后支持短时撤销恢复原文件，退出清理或空间让渡后才删除磁盘副本', async () => {
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
    // 撤销期内磁盘上的唯一副本仍保留
    expect(existsSync(item.path)).toBe(true)

    const undoRes = await dock.undoRemove()
    expect(undoRes.ok).toBe(true)
    expect(undoRes.restored).toBe(1)
    expect(dock.items).toHaveLength(1)
    expect(dock.items[0].id).toBe(item.id)
    expect(existsSync(item.path)).toBe(true)

    // 退出前清理会把待删缓冲区的物理副本清掉
    await dock.clear()
    expect(dock.items).toHaveLength(0)
    dock.flushPendingDeletesSync()
    expect(existsSync(item.path)).toBe(false)
    expect((await dock.undoRemove()).ok).toBe(false)
  })

  it('当新写入副本需要空间时自动释放撤销缓冲区的磁盘占用', async () => {
    const dataDir = makeTempDir('pocket-isle-data-')
    const store = new Store(dataDir)
    store.data.settings.copyLimitMB = 64
    const dock = new Dock(store, join(dataDir, 'dock-copies'), [], join(dataDir, 'drop.log'))

    await dock.addBufferItem('big1.bin', Buffer.alloc(40 * 1024 * 1024, 1), 'clipboard://text')
    const oldCopyPath = dock.items[0].path
    await dock.clear()
    expect(existsSync(oldCopyPath)).toBe(true)

    // 再写入 35 MiB 副本（active 0 + 35 <= 64，但与 undo 40 之和 > 64），应释放旧撤销副本并允许写入
    const res = await dock.addBufferItem(
      'big2.bin',
      Buffer.alloc(35 * 1024 * 1024, 2),
      'clipboard://text'
    )
    expect(res.added).toBe(1)
    expect(existsSync(oldCopyPath)).toBe(false)
    expect(dock.hasActiveUndo()).toBe(false)
  })

  it('删除副本失败时记录待清理墓碑并在用量中保留占位；释放后重试可清理并归零用量；默认不生成 drop-log.txt', async () => {
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
    // 第一次在 removeDir 被锁住（或 flushPendingDeletesSync 无法删时）：测试 retryPendingDeletes 路径
    // 重新添加并用第二个条目触发 purgeUndoBatch 失败
    await dock.add([f])
    const lockedPath = dock.items[0].path
    const lockedDir = dirname(lockedPath)
    await dock.remove([dock.items[0].id])
    // 插入另一项后再 remove 触发 purgeUndoBatch -> 调用 mocked removeDir（抛错）
    const f2 = join(tempDir, 'temp2.bin')
    writeFileSync(f2, Buffer.from('small'))
    await dock.add([f2])
    await dock.remove([dock.items[0].id])

    expect(existsSync(lockedDir)).toBe(true)
    expect(store.data.pendingDeletes).toContain(lockedDir)
    expect(dock.copyUsage()).toBe(1024 * 1024)

    // 模拟解锁并调用 reconcileCopies，同时放一个孤儿目录与旧 drop-log.txt 验证启动清理
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
