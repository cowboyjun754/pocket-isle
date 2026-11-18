import { DEFAULT_LOCALE, getMessages } from '../../shared/i18n'
import type { AddResult, AppLocale, DockItem } from '../../shared/types'

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'heic'])

export const TEXT_PREVIEW_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'tsv',
  'log',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'css',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'c',
  'cpp',
  'h',
  'java',
  'go',
  'rs',
  'sql',
  'ini',
  'toml',
  'bat',
  'ps1',
  'sh'
])

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function describeResult(r: AddResult, locale: AppLocale = DEFAULT_LOCALE): string | null {
  const m = getMessages(locale).result
  const parts: string[] = []
  if (r.added) parts.push(m.added(r.added))
  if (r.skipped) {
    if (r.added) {
      parts.push(m.skippedMore(r.skipped))
    } else {
      parts.push(r.skipped === 1 ? m.skippedOne : m.skippedMany)
    }
  }
  if (r.errors.length) parts.push(r.errors[0] + (r.errors.length > 1 ? m.extraErrors(r.errors.length) : ''))
  return parts.length ? parts.join(m.separator) : null
}

/** Resolves the exact Dock "AI Organize" item scope based on checked selection and active search filter. */
export function resolveOrganizeScope(params: {
  items: DockItem[]
  filteredItems: DockItem[]
  selected: Set<string>
  query: string
}): {
  targetIds: string[] | undefined
  count: number
  mode: 'selected' | 'filtered' | 'all'
} {
  if (params.selected.size > 0) {
    return {
      targetIds: [...params.selected],
      count: params.selected.size,
      mode: 'selected'
    }
  }
  if (params.query.trim()) {
    return {
      targetIds: params.filteredItems.map((i) => i.id),
      count: params.filteredItems.length,
      mode: 'filtered'
    }
  }
  return {
    targetIds: undefined,
    count: params.items.length,
    mode: 'all'
  }
}

/** Includes only explicitly checked files for focus breakdown (never silently attaches recent files). */
export function resolveBreakdownDocIds(focusDocIds: Set<string>): string[] {
  return [...focusDocIds]
}

/** Formats a millisecond countdown as `MM:SS` (ceil to whole seconds, negative values clamped to 00:00). */
export function formatDurationMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
