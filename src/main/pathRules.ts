/**
 * Determines whether dropped files should be safely copied into app-managed storage.
 * Files inside temp directories or WeChat caches may expire, so they are copied; others store paths only.
 */

const COPY_PATTERNS: RegExp[] = [
  // New WeChat (xwechat_files) / legacy WeChat Files temp and cache folders
  /\\(xwechat_files|wechat files)\\(.*\\)?(temp|tmp|cache)\\/i,
  // Tencent app data temp and cache folders
  /\\tencent\\(.*\\)?(temp|tmp|cache)\\/i
]

export function normalizeWinPath(p: string): string {
  return p.replace(/\//g, '\\')
}

export function isUnder(p: string, root: string): boolean {
  const a = normalizeWinPath(p).toLowerCase()
  const r = normalizeWinPath(root).toLowerCase().replace(/\\+$/, '') + '\\'
  return a.startsWith(r)
}

export function shouldCopy(p: string, tempRoots: string[]): boolean {
  if (tempRoots.some((root) => root && isUnder(p, root))) return true
  const norm = normalizeWinPath(p)
  return COPY_PATTERNS.some((re) => re.test(norm))
}

export function samePath(a: string, b: string): boolean {
  return normalizeWinPath(a).toLowerCase() === normalizeWinPath(b).toLowerCase()
}
