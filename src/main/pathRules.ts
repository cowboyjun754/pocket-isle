/**
 * 判断拖入的文件是否需要"自动复制一份"。
 * 临时目录、微信缓存/临时目录里的文件随时可能被清理，所以复制；其他只存路径。
 * 微信的真实路径要在第 1 阶段实测后补充（见 drop-log.txt）。
 */

const COPY_PATTERNS: RegExp[] = [
  // 新版微信 xwechat_files / 旧版 WeChat Files 下的临时、缓存目录
  /\\(xwechat_files|wechat files)\\(.*\\)?(temp|tmp|cache)\\/i,
  // 腾讯系应用数据目录里的临时、缓存目录
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
