/** 生成剪贴板截图/文本的安全文件名（保留可读前缀与时间戳，不含 Windows 非法路径字符） */
export function buildClipboardFilename(
  kind: 'image' | 'text',
  textPreview?: string,
  now = new Date()
): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

  if (kind === 'image') {
    return `截图_${datePart}_${timePart}.png`
  }

  const firstLine = (textPreview ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)

  const sanitized = (firstLine ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14)
    .replace(/[. ]+$/g, '')

  return sanitized ? `便签_${sanitized}_${timePart}.txt` : `便签_${datePart}_${timePart}.txt`
}
