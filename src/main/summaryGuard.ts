import type { FileSummary } from '../shared/types'

export function asCleanText(val: unknown, maxLen: number): string {
  if (typeof val === 'string') return val.trim().slice(0, maxLen)
  if (typeof val === 'number' || typeof val === 'boolean') return String(val).slice(0, maxLen)
  return ''
}

export function sanitizeFileSummary(raw: unknown): FileSummary | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const brief = asCleanText(obj.brief, 180) || '暂无简介'
  const bullets = Array.isArray(obj.bullets)
    ? obj.bullets
        .map((b) => asCleanText(b, 80))
        .filter((s) => s.length > 0)
        .slice(0, 4)
    : []
  const attention = asCleanText(obj.attention, 120) || undefined
  const readNote = asCleanText(obj.readNote, 120) || undefined
  const readStatus: FileSummary['readStatus'] =
    obj.readStatus === 'full' || obj.readStatus === 'partial' || obj.readStatus === 'meta-only'
      ? obj.readStatus
      : 'meta-only'
  const updatedAt =
    typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : Date.now()
  return {
    brief,
    bullets,
    ...(attention ? { attention } : {}),
    readStatus,
    ...(readNote ? { readNote } : {}),
    updatedAt
  }
}
