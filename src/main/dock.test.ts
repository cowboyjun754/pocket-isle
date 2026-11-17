import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
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
