import { getMessages } from '../shared/i18n'
import type { AppLocale } from '../shared/types'

/** Builds a sanitized Windows-safe filename for clipboard screenshots/text snippets with timestamp. */
export function buildClipboardFilename(
  kind: 'image' | 'text',
  textPreview?: string,
  now = new Date(),
  locale: AppLocale = 'zh-CN'
): string {
  const m = getMessages(locale).clipboard
  const pad = (n: number): string => String(n).padStart(2, '0')
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

  if (kind === 'image') {
    return `${m.imagePrefix}_${datePart}_${timePart}.png`
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

  return sanitized
    ? `${m.notePrefix}_${sanitized}_${timePart}.txt`
    : `${m.notePrefix}_${datePart}_${timePart}.txt`
}
