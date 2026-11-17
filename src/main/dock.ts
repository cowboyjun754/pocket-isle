import { randomUUID } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { basename, dirname, extname, join, resolve, sep } from 'path'
import type { AddResult, DockItem, FileSummary } from '../shared/types'
import { samePath, shouldCopy } from './pathRules'
import type { Store } from './store'

/** 文件口袋：添加、去重、自动复制、移除 */
export class Dock {
  constructor(
    private store: Store,
    private copiesRoot: string,
    private tempRoots: string[],
    private logFile: string
  ) {}

  get items(): DockItem[] {
    return this.store.data.items
  }

  find(id: string): DockItem | undefined {
    return this.items.find((i) => i.id === id)
  }

  async listWithStatus(): Promise<DockItem[]> {
    return Promise.all(
      this.items.map(async (it) => ({ ...it, available: await exists(it.path) }))
    )
  }

  copyUsage(): number {
    return this.items.filter((i) => i.isCopy).reduce((s, i) => s + i.size, 0)
  }

  copyLimit(): number {
    return this.store.data.settings.copyLimitMB * 1024 * 1024
  }

  async add(paths: string[]): Promise<AddResult> {
    const result: AddResult = { added: 0, skipped: 0, errors: [] }
    for (const raw of paths) {
      if (!raw) {
        result.errors.push('有一项不是磁盘上的文件，无法暂存')
        continue
      }
      let st: Awaited<ReturnType<typeof fs.stat>>
      try {
        st = await fs.stat(raw)
      } catch {
        result.errors.push(`无法读取：${basename(raw)}`)
        continue
      }
      if (st.isDirectory()) {
        result.errors.push(`暂不支持文件夹：${basename(raw)}`)
        continue
      }

      const copy = shouldCopy(raw, this.tempRoots)
      await this.log(raw, copy)

      const dup = this.items.find(
        (i) =>
          samePath(i.sourcePath, raw) &&
          (!copy || (i.isCopy && i.size === st.size && i.mtimeMs === st.mtimeMs))
      )
      if (dup) {
        result.skipped++
        continue
      }

      const id = randomUUID()
      const name = basename(raw)
      let usePath = raw
      if (copy) {
        if (this.copyUsage() + st.size > this.copyLimit()) {
          result.errors.push(`副本空间不足（上限 ${this.store.data.settings.copyLimitMB} MB）：${name}`)
          continue
        }
        try {
          const dir = join(this.copiesRoot, id)
          await fs.mkdir(dir, { recursive: true })
          usePath = join(dir, name)
          await fs.copyFile(raw, usePath)
        } catch {
          result.errors.push(`复制失败：${name}`)
          continue
        }
      }

      this.store.update((d) =>
        d.items.push({
          id,
          name,
          ext: extname(name).slice(1).toLowerCase(),
          path: usePath,
          sourcePath: raw,
          isCopy: copy,
          size: st.size,
          mtimeMs: st.mtimeMs,
          addedAt: Date.now()
        })
      )
      result.added++
    }
    return result
  }

  /** 将内存缓冲区（如剪贴板截图或文本）保存为码头副本 */
  async addBufferItem(name: string, buf: Buffer, sourcePath: string): Promise<AddResult> {
    if (this.copyUsage() + buf.length > this.copyLimit()) {
      return {
        added: 0,
        skipped: 0,
        errors: [`副本空间不足（上限 ${this.store.data.settings.copyLimitMB} MB）：${name}`]
      }
    }
    const id = randomUUID()
    const dir = join(this.copiesRoot, id)
    const filePath = join(dir, name)
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(filePath, buf)
    } catch {
      return { added: 0, skipped: 0, errors: [`保存剪贴板内容失败：${name}`] }
    }
    const now = Date.now()
    this.store.update((d) =>
      d.items.push({
        id,
        name,
        ext: extname(name).slice(1).toLowerCase(),
        path: filePath,
        sourcePath,
        isCopy: true,
        size: buf.length,
        mtimeMs: now,
        addedAt: now
      })
    )
    return { added: 1, skipped: 0, errors: [] }
  }

  async remove(ids: string[]): Promise<void> {
    const set = new Set(ids)
    const removed = this.items.filter((i) => set.has(i.id))
    this.store.update((d) => {
      d.items = d.items.filter((i) => !set.has(i.id))
    })
    for (const it of removed) if (it.isCopy) await this.deleteCopy(it.path)
  }

  async clear(): Promise<void> {
    await this.remove(this.items.map((i) => i.id))
  }

  /** 修改应用内分组（仅改应用内组织，不改磁盘原文件） */
  setGroup(ids: string[], group: string | undefined): void {
    const set = new Set(ids)
    const clean = group?.trim() || undefined
    this.store.update((d) => {
      for (const it of d.items) {
        if (set.has(it.id)) it.group = clean
      }
    })
  }

  /** 批量写入 AI 分组与文件速览 */
  applyAiUpdates(updates: Map<string, { group: string; summary: FileSummary }>): void {
    this.store.update((d) => {
      for (const it of d.items) {
        const u = updates.get(it.id)
        if (u) {
          it.group = u.group
          it.summary = u.summary
        }
      }
    })
  }

  /** 只返回仍然存在的文件路径，用于拖出 */
  pathsFor(ids: string[]): string[] {
    return ids
      .map((id) => this.find(id))
      .filter((i): i is DockItem => !!i)
      .map((i) => i.path)
      .filter((p) => existsSync(p))
  }

  /** 只删除应用副本目录里的内容，绝不碰其他位置 */
  private async deleteCopy(p: string): Promise<void> {
    const dir = resolve(dirname(p))
    const root = resolve(this.copiesRoot) + sep
    if (!dir.startsWith(root)) return
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }

  /** 记录拖入的原始路径，用于第 1 阶段确认微信等来源的真实路径 */
  private async log(p: string, copy: boolean): Promise<void> {
    const line = `${new Date().toISOString()}\t${copy ? 'COPY' : 'REF '}\t${p}\n`
    await fs.appendFile(this.logFile, line, 'utf8').catch(() => undefined)
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
