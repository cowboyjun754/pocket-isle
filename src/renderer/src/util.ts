import type { AddResult } from '../../shared/types'

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

export function describeResult(r: AddResult): string | null {
  const parts: string[] = []
  if (r.added) parts.push(`收到 ${r.added} 个文件`)
  if (r.skipped) {
    if (r.added) {
      parts.push(`${r.skipped} 个已在码头`)
    } else {
      parts.push(r.skipped === 1 ? '这个文件已经在码头了哦' : '这些文件已经在码头了哦')
    }
  }
  if (r.errors.length) parts.push(r.errors[0] + (r.errors.length > 1 ? ` 等 ${r.errors.length} 项` : ''))
  return parts.length ? parts.join('，') : null
}
