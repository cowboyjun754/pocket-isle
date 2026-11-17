import type { ParcelKind } from './types'

const SCROLL_EXTS = new Set([
  'doc',
  'docx',
  'pdf',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'rtf',
  'odt',
  'pages',
  'key',
  'numbers',
  'epub'
])

const BOX_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'svg',
  'tif',
  'tiff',
  'heic',
  'psd',
  'ai',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'xz',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'mp3',
  'wav',
  'flac',
  'aac',
  'exe',
  'msi',
  'dmg',
  'apk'
])

/** 根据扩展名映射水彩包裹外观：文档类→卷轴，图片/音视频/压缩包→纸箱，文本/代码/其他→信封 */
export function getParcelKindForExt(ext?: string): ParcelKind {
  const clean = (ext ?? '').trim().replace(/^\./, '').toLowerCase()
  if (SCROLL_EXTS.has(clean)) return 'scroll'
  if (BOX_EXTS.has(clean)) return 'box'
  return 'envelope'
}
