import { randomUUID } from 'crypto'
import { existsSync, promises as fs, rmSync } from 'fs'
import { basename, dirname, extname, join, resolve, sep } from 'path'
import type { AddResult, DockItem, DockUndoState, FileSummary, UndoResult } from '../shared/types'
import { samePath, shouldCopy } from './pathRules'
import type { Store } from './store'

export interface DockOptions {
  undoTtlMs?: number
  onUndoChanged?: (state: DockUndoState | null) => void
  enableDropLog?: boolean
  removeDir?: (dir: string) => Promise<void>
}

interface UndoEntry {
  item: DockItem
  index: number
}

interface UndoBatch {
  token: string
  entries: UndoEntry[]
  label: string
  copyCount: number
  expiresAt: number
  timer: NodeJS.Timeout | null
}

const DEFAULT_UNDO_TTL_MS = 20_000

/** Staged file dock: serialized mutations, deduplication, quota reservation, safe copies & short-time undo. */
export class Dock {
  private opChain: Promise<void> = Promise.resolve()
  private pendingCopyBytes = 0
  private pendingDeleteSizes = new Map<string, number>()
  private undoBatch: UndoBatch | null = null
  private undoTtlMs: number
  private enableDropLog: boolean
  private removeDirImpl: (dir: string) => Promise<void>
  private onUndoChanged?: (state: DockUndoState | null) => void

  constructor(
    private store: Store,
    private copiesRoot: string,
    private tempRoots: string[],
    private logFile: string,
    opts?: DockOptions
  ) {
    this.undoTtlMs = Math.max(1000, opts?.undoTtlMs ?? DEFAULT_UNDO_TTL_MS)
    this.enableDropLog = !!opts?.enableDropLog
    this.removeDirImpl =
      opts?.removeDir ?? ((dir: string) => fs.rm(dir, { recursive: true, force: true }))
    this.onUndoChanged = opts?.onUndoChanged
  }

  get items(): DockItem[] {
    return this.store.data.items
  }

  find(id: string): DockItem | undefined {
    return this.items.find((i) => i.id === id)
  }

  hasActiveUndo(): boolean {
    return this.undoBatch !== null
  }

  getUndoState(): DockUndoState | null {
    if (!this.undoBatch) return null
    return {
      token: this.undoBatch.token,
      count: this.undoBatch.entries.length,
      copyCount: this.undoBatch.copyCount,
      label: this.undoBatch.label,
      expiresAt: this.undoBatch.expiresAt
    }
  }

  private emitUndoState(): void {
    this.onUndoChanged?.(this.getUndoState())
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.opChain.then(fn, fn)
    this.opChain = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  async listWithStatus(): Promise<DockItem[]> {
    return Promise.all(
      this.items.map(async (it) => ({ ...it, available: await exists(it.path) }))
    )
  }

  copyUsage(): number {
    const active = this.items.filter((i) => i.isCopy).reduce((s, i) => s + i.size, 0)
    let pending = 0
    for (const sz of this.pendingDeleteSizes.values()) pending += sz
    return active + pending
  }

  private undoCopyUsage(): number {
    if (!this.undoBatch) return 0
    return this.undoBatch.entries
      .filter((e) => e.item.isCopy)
      .reduce((s, e) => s + e.item.size, 0)
  }

  copyLimit(): number {
    return this.store.data.settings.copyLimitMB * 1024 * 1024
  }

  private async reserveQuotaForCopy(bytes: number): Promise<boolean> {
    if ((this.store.data.pendingDeletes?.length ?? 0) > 0) {
      await this.retryPendingDeletes()
    }
    const limit = this.copyLimit()
    if (this.copyUsage() + this.pendingCopyBytes + bytes > limit) {
      return false
    }
    if (this.copyUsage() + this.undoCopyUsage() + this.pendingCopyBytes + bytes > limit) {
      await this.purgeUndoBatch(true)
    }
    if (this.copyUsage() + this.pendingCopyBytes + bytes > limit) {
      return false
    }
    this.pendingCopyBytes += bytes
    return true
  }

  private releaseQuota(bytes: number): void {
    this.pendingCopyBytes = Math.max(0, this.pendingCopyBytes - bytes)
  }

  private async purgeUndoBatch(notify: boolean): Promise<void> {
    const batch = this.undoBatch
    if (!batch) return
    if (batch.timer) clearTimeout(batch.timer)
    this.undoBatch = null
    if (notify) this.emitUndoState()
    for (const { item } of batch.entries) {
      if (item.isCopy) await this.deleteCopy(item.path, item.size)
    }
  }

  private async expireUndoBatch(token: string): Promise<void> {
    if (!this.undoBatch || this.undoBatch.token !== token) return
    await this.purgeUndoBatch(true)
  }

  async add(paths: string[]): Promise<AddResult> {
    return this.serialize(async () => {
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
        const isDir = st.isDirectory()
        const copy = isDir ? false : shouldCopy(raw, this.tempRoots)
        await this.log(raw, copy)

        const dup = this.items.find(
          (i) =>
            samePath(i.path, raw) ||
            (samePath(i.sourcePath, raw) &&
              (!copy || (i.isCopy && i.size === st.size && i.mtimeMs === st.mtimeMs)))
        )
        if (dup) {
          result.skipped++
          continue
        }

        const id = randomUUID()
        const name = basename(raw)
        let usePath = raw
        if (copy) {
          const reserved = await this.reserveQuotaForCopy(st.size)
          if (!reserved) {
            result.errors.push(
              `副本空间不足（上限 ${this.store.data.settings.copyLimitMB} MB）：${name}`
            )
            continue
          }
          const dir = join(this.copiesRoot, id)
          usePath = join(dir, name)
          try {
            await fs.mkdir(dir, { recursive: true })
            await fs.copyFile(raw, usePath)
          } catch {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
            result.errors.push(`复制失败：${name}`)
            continue
          } finally {
            this.releaseQuota(st.size)
          }
        }

        this.store.update((d) =>
          d.items.push({
            id,
            name,
            ext: isDir ? 'dir' : extname(name).slice(1).toLowerCase(),
            path: usePath,
            sourcePath: raw,
            isCopy: copy,
            ...(isDir ? { isDir: true } : {}),
            size: isDir ? 0 : st.size,
            mtimeMs: st.mtimeMs,
            addedAt: Date.now()
          })
        )
        result.added++
      }
      return result
    })
  }

  /** Saves an in-memory buffer (e.g., clipboard screenshot or text snippet) as a dock copy. */
  async addBufferItem(name: string, buf: Buffer, sourcePath: string): Promise<AddResult> {
    return this.serialize(async () => {
      const reserved = await this.reserveQuotaForCopy(buf.length)
      if (!reserved) {
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
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
        return { added: 0, skipped: 0, errors: [`保存剪贴板内容失败：${name}`] }
      } finally {
        this.releaseQuota(buf.length)
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
    })
  }

  async remove(ids: string[]): Promise<void> {
    return this.serialize(async () => {
      const set = new Set(ids)
      const removedEntries: UndoEntry[] = []
      this.items.forEach((item, index) => {
        if (set.has(item.id)) removedEntries.push({ item, index })
      })
      if (removedEntries.length === 0) return

      await this.purgeUndoBatch(false)

      this.store.update((d) => {
        d.items = d.items.filter((i) => !set.has(i.id))
      })

      const token = randomUUID()
      const copyCount = removedEntries.filter((e) => e.item.isCopy).length
      const label =
        removedEntries.length === 1
          ? removedEntries[0].item.name
          : `${removedEntries.length} 个条目`
      const timer = setTimeout(() => {
        void this.serialize(() => this.expireUndoBatch(token))
      }, this.undoTtlMs)

      this.undoBatch = {
        token,
        entries: removedEntries,
        label,
        copyCount,
        expiresAt: Date.now() + this.undoTtlMs,
        timer
      }
      this.emitUndoState()
    })
  }

  async clear(): Promise<void> {
    const allIds = this.items.map((i) => i.id)
    if (allIds.length === 0) return
    await this.remove(allIds)
  }

  async undoRemove(token?: string): Promise<UndoResult> {
    return this.serialize(async () => {
      const batch = this.undoBatch
      if (!batch || (token && batch.token !== token)) {
        return { ok: false, restored: 0, message: '撤销时间已过或没有可恢复的移除记录' }
      }
      if (batch.timer) clearTimeout(batch.timer)
      this.undoBatch = null

      const toRestore: UndoEntry[] = []
      for (const entry of batch.entries) {
        if (entry.item.isCopy && !(await exists(entry.item.path))) {
          continue
        }
        toRestore.push(entry)
      }

      let restored = 0
      if (toRestore.length > 0) {
        this.store.update((d) => {
          const sorted = [...toRestore].sort((a, b) => a.index - b.index)
          for (const entry of sorted) {
            const existsAlready = d.items.some(
              (i) => i.id === entry.item.id || samePath(i.path, entry.item.path)
            )
            if (existsAlready) continue
            const insertAt = Math.min(Math.max(0, entry.index), d.items.length)
            d.items.splice(insertAt, 0, entry.item)
            restored++
          }
        })
      }

      this.emitUndoState()
      return restored > 0
        ? { ok: true, restored, message: `已撤销移除，恢复 ${restored} 项到码头` }
        : { ok: false, restored: 0, message: '未能恢复文件（副本可能已失效）' }
    })
  }

  /** Synchronously purges pending undo-buffer copy dirs before app exit (records tombstones on failure). */
  flushPendingDeletesSync(): void {
    const batch = this.undoBatch
    if (!batch) return
    if (batch.timer) clearTimeout(batch.timer)
    this.undoBatch = null
    for (const { item } of batch.entries) {
      if (!item.isCopy) continue
      const dir = resolve(dirname(item.path))
      if (!this.isInsideCopiesRoot(dir)) continue
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* fallback check below */
      }
      if (existsSync(dir)) {
        this.recordPendingDelete(dir, item.size)
      }
    }
  }

  /** Startup reconciliation: retries failed deletes, sweeps orphan copy dirs, and deletes legacy drop-log.txt when disabled. */
  async reconcileCopies(): Promise<void> {
    return this.serialize(async () => {
      await this.retryPendingDeletes()
      if (!this.enableDropLog && existsSync(this.logFile)) {
        await fs.rm(this.logFile, { force: true }).catch(() => undefined)
      }
      if (!existsSync(this.copiesRoot)) return
      const activeDirs = new Set<string>()
      for (const it of this.items) {
        if (it.isCopy) activeDirs.add(this.normalizeKey(resolve(dirname(it.path))))
      }
      if (this.undoBatch) {
        for (const { item } of this.undoBatch.entries) {
          if (item.isCopy) activeDirs.add(this.normalizeKey(resolve(dirname(item.path))))
        }
      }
      const entries = await fs.readdir(this.copiesRoot, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const subDir = resolve(join(this.copiesRoot, entry.name))
        if (activeDirs.has(this.normalizeKey(subDir))) continue
        const bytes = await measureDirSize(subDir)
        await this.tryRemoveDir(subDir, bytes)
      }
    })
  }

  async retryPendingDeletes(): Promise<void> {
    const list = [...(this.store.data.pendingDeletes ?? [])]
    if (list.length === 0) return
    const remaining: string[] = []
    for (const rawDir of list) {
      const dir = resolve(rawDir)
      if (!this.isInsideCopiesRoot(dir)) continue
      if (!existsSync(dir)) {
        this.pendingDeleteSizes.delete(this.normalizeKey(dir))
        continue
      }
      try {
        await this.removeDirImpl(dir)
      } catch {
        /* ignore */
      }
      if (existsSync(dir)) {
        remaining.push(dir)
        if (!this.pendingDeleteSizes.has(this.normalizeKey(dir))) {
          this.pendingDeleteSizes.set(this.normalizeKey(dir), await measureDirSize(dir))
        }
      } else {
        this.pendingDeleteSizes.delete(this.normalizeKey(dir))
      }
    }
    if (
      remaining.length !== list.length ||
      remaining.some((v, idx) => v !== list[idx])
    ) {
      this.store.update((d) => {
        d.pendingDeletes = remaining
      })
    }
  }

  /** Updates virtual in-app groups without touching original files on disk. */
  setGroup(ids: string[], group: string | undefined): Promise<void> {
    return this.serialize(async () => {
      const set = new Set(ids)
      const clean = group?.trim() || undefined
      this.store.update((d) => {
        for (const it of d.items) {
          if (set.has(it.id)) it.group = clean
        }
      })
    })
  }

  /** Applies batch AI-generated groups and file summaries. */
  applyAiUpdates(updates: Map<string, { group: string; summary: FileSummary }>): Promise<void> {
    return this.serialize(async () => {
      this.store.update((d) => {
        for (const it of d.items) {
          const u = updates.get(it.id)
          if (u) {
            it.group = u.group
            it.summary = u.summary
          }
        }
      })
    })
  }

  /** Returns only existing disk paths eligible for outbound OS dragging. */
  pathsFor(ids: string[]): string[] {
    return ids
      .map((id) => this.find(id))
      .filter((i): i is DockItem => !!i)
      .map((i) => i.path)
      .filter((p) => existsSync(p))
  }

  private normalizeKey(p: string): string {
    return process.platform === 'win32' ? p.toLowerCase() : p
  }

  private isInsideCopiesRoot(dir: string): boolean {
    const normDir = this.normalizeKey(resolve(dir))
    const normRoot = this.normalizeKey(resolve(this.copiesRoot) + sep)
    return normDir.startsWith(normRoot)
  }

  private recordPendingDelete(dir: string, sizeHint: number): void {
    const resolved = resolve(dir)
    const key = this.normalizeKey(resolved)
    this.pendingDeleteSizes.set(key, Math.max(0, sizeHint))
    const existing = this.store.data.pendingDeletes ?? []
    if (!existing.some((p) => this.normalizeKey(resolve(p)) === key)) {
      this.store.update((d) => {
        d.pendingDeletes = [...(d.pendingDeletes ?? []), resolved]
      })
    }
  }

  private async tryRemoveDir(dir: string, sizeHint: number): Promise<void> {
    if (!this.isInsideCopiesRoot(dir)) return
    try {
      await this.removeDirImpl(dir)
    } catch {
      /* handled via existence check below */
    }
    if (existsSync(dir)) {
      this.recordPendingDelete(dir, sizeHint)
    } else {
      const key = this.normalizeKey(resolve(dir))
      this.pendingDeleteSizes.delete(key)
      if ((this.store.data.pendingDeletes ?? []).some((p) => this.normalizeKey(resolve(p)) === key)) {
        this.store.update((d) => {
          d.pendingDeletes = (d.pendingDeletes ?? []).filter(
            (p) => this.normalizeKey(resolve(p)) !== key
          )
        })
      }
    }
  }

  /** Deletes contents strictly inside the managed copies root; records failed deletes as tombstones. */
  private async deleteCopy(p: string, sizeHint = 0): Promise<void> {
    await this.tryRemoveDir(dirname(p), sizeHint)
  }

  /** Appends dropped paths to diagnostic log only when POCKET_ISLE_DROP_LOG=1 is enabled. */
  private async log(p: string, copy: boolean): Promise<void> {
    if (!this.enableDropLog) return
    const line = `${new Date().toISOString()}\t${copy ? 'COPY' : 'REF '}\t${p}\n`
    await fs.appendFile(this.logFile, line, 'utf8').catch(() => undefined)
  }
}

async function measureDirSize(dir: string): Promise<number> {
  let total = 0
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) total += await measureDirSize(full)
      else if (entry.isFile()) {
        const st = await fs.stat(full).catch(() => null)
        if (st) total += st.size
      }
    }
  } catch {
    /* ignore */
  }
  return total
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
