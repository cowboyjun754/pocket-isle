export interface DataTransferLike {
  files: ArrayLike<File>
  getData(format: string): string
}

/** 将 file:// URI 转换为本地 Windows 路径，非 file:// 协议或格式异常返回 null */
export function parseFileUri(raw: string): string | null {
  const s = raw.trim()
  if (!/^file:/i.test(s)) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'file:') return null
    const decodedPath = decodeURIComponent(u.pathname)
    if (u.hostname && u.hostname.toLowerCase() !== 'localhost') {
      return `\\\\${u.hostname}${decodedPath.replace(/\//g, '\\')}`
    }
    const winPath = decodedPath.replace(/^\/([a-zA-Z]:)/, '$1')
    if (!/^[a-zA-Z]:[\\/]/.test(winPath)) return null
    return winPath.replace(/\//g, '\\')
  } catch {
    return null
  }
}

/** 识别单行文本是否为有效的本地绝对路径或 file:// URI */
export function parseLocalPathCandidate(raw: string): string | null {
  const s = raw.trim().replace(/^["']|["']$/g, '')
  if (!s) return null
  if (/^file:/i.test(s)) return parseFileUri(s)
  if (/^[a-zA-Z]:[\\/]/.test(s)) return s.replace(/\//g, '\\')
  if (/^\\\\[^\\]+\\[^\\]+/.test(s)) return s
  return null
}

function decodeHtmlAttr(val: string): string {
  return val
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const key = p.replace(/\//g, '\\').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

/**
 * 从拖拽 DataTransfer 中提取本地文件路径：
 * 1. 优先读取原生文件列表（资源管理器/微信拖入）；
 * 2. 回退支持 IDE 标签页/文件树（ResourceURLs）、链接/路径（text/uri-list、text/html、text/plain）。
 */
export function extractPathsFromDataTransfer(
  dt: DataTransferLike,
  getPathForFile: (file: File) => string
): string[] {
  const fromFiles: string[] = []
  for (let i = 0; i < dt.files.length; i++) {
    const f = dt.files[i]
    if (!f) continue
    const p = getPathForFile(f)
    if (p) fromFiles.push(p)
  }
  if (fromFiles.length > 0) return dedupePaths(fromFiles)

  const candidates: string[] = []

  const resourceRaw = dt.getData('ResourceURLs')
  if (resourceRaw) {
    try {
      const parsed = JSON.parse(resourceRaw)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') {
            const p = parseLocalPathCandidate(item)
            if (p) candidates.push(p)
          }
        }
      }
    } catch {
      /* ignore malformed ResourceURLs */
    }
  }

  const uriListRaw = dt.getData('text/uri-list')
  if (uriListRaw) {
    for (const line of uriListRaw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const p = parseLocalPathCandidate(trimmed)
      if (p) candidates.push(p)
    }
  }

  const htmlRaw = dt.getData('text/html')
  if (htmlRaw) {
    const hrefRe = /href\s*=\s*["']([^"']+)["']/gi
    let m: RegExpExecArray | null
    while ((m = hrefRe.exec(htmlRaw)) !== null) {
      const p = parseFileUri(decodeHtmlAttr(m[1]))
      if (p) candidates.push(p)
    }
  }

  if (candidates.length === 0) {
    const textRaw = dt.getData('text/plain')
    if (textRaw) {
      for (const line of textRaw.split(/\r?\n/)) {
        const p = parseLocalPathCandidate(line)
        if (p) candidates.push(p)
      }
    }
  }

  return dedupePaths(candidates)
}

/** 根据拖出源的 effectAllowed 协商兼容的 dropEffect，避免拖拽链接或 IDE 标签时被 Chromium 禁止 */
export function chooseDropEffect(effectAllowed?: string): 'copy' | 'link' | 'move' {
  const lower = (effectAllowed ?? '').toLowerCase()
  if (!lower || lower === 'uninitialized' || lower === 'all' || lower.includes('copy')) {
    return 'copy'
  }
  if (lower.includes('link')) return 'link'
  if (lower.includes('move')) return 'move'
  return 'copy'
}
