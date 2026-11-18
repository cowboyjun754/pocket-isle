import { promises as fs } from 'fs'
import { inflateRawSync, inflateSync } from 'zlib'
import type { DockItem } from '../shared/types'

export const TEXT_EXTS = new Set([
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

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'])

export const MAX_OFFICE_INPUT_BYTES = 20 * 1024 * 1024
export const MAX_ZIP_ENTRY_OUT = 4 * 1024 * 1024
export const MAX_ZIP_TOTAL_OUT = 10 * 1024 * 1024
export const MAX_PDF_INPUT_BYTES = 12 * 1024 * 1024
export const MAX_PDF_SCAN_BYTES = 6 * 1024 * 1024
export const MAX_PDF_TOTAL_OUT = 8 * 1024 * 1024

export interface ExtractedDoc {
  id: string
  name: string
  ext: string
  size: number
  snippet: string
  readStatus: 'full' | 'partial' | 'meta-only'
  readNote?: string
  imageDataUrl?: string
  attachedImage?: boolean
}

export function decodeTextBuffer(buf: Buffer, opts?: { trim?: boolean }): string {
  const shouldTrim = opts?.trim ?? false
  let text: string
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.subarray(2).toString('utf16le').replace(/\0/g, '')
  } else {
    const utf8 = buf.toString('utf8').replace(/\0/g, '')
    text = utf8.startsWith('\uFEFF') ? utf8.slice(1) : utf8
  }
  return shouldTrim ? text.trim() : text
}

/** Safely reads up to maxBytes of plain text files, preserving indentation and newlines by default for preview/copy. */
export async function readTextFilePreview(
  filePath: string,
  maxBytes = 64 * 1024,
  opts?: { trim?: boolean }
): Promise<{ content: string; truncated: boolean }> {
  const st = await fs.stat(filePath)
  const readSize = Math.min(st.size, maxBytes)
  if (readSize === 0) return { content: '', truncated: false }
  const fd = await fs.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(readSize)
    const { bytesRead } = await fd.read(buf, 0, readSize, 0)
    const content = decodeTextBuffer(buf.subarray(0, bytesRead), opts)
    return { content, truncated: st.size > bytesRead }
  } finally {
    await fd.close()
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n) || 32))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16) || 32))
}

function stripXmlText(xml: string, breakTagPattern: RegExp): string {
  return decodeXmlEntities(
    xml
      .replace(breakTagPattern, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractXlsxPreview(
  entries: Map<string, string>,
  maxChars: number
): { text: string; truncated: boolean; reason?: string } {
  const sharedStringsXml = entries.get('xl/sharedStrings.xml')
  const sharedStrings: string[] = []
  if (sharedStringsXml) {
    const siMatches = sharedStringsXml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) ?? []
    for (const si of siMatches) {
      const parts: string[] = []
      const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g
      let tm: RegExpExecArray | null
      while ((tm = tRegex.exec(si)) !== null) parts.push(decodeXmlEntities(tm[1]))
      sharedStrings.push(parts.join(''))
    }
  }

  const sheetNames: string[] = []
  const workbookXml = entries.get('xl/workbook.xml')
  if (workbookXml) {
    const sRegex = /<sheet\b[^>]*name="([^"]+)"[^>]*\/?>/g
    let sm: RegExpExecArray | null
    while ((sm = sRegex.exec(workbookXml)) !== null) sheetNames.push(decodeXmlEntities(sm[1]))
  }

  const sheetEntries = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(a[0].match(/sheet(\d+)\.xml/i)?.[1] ?? 0)
      const nb = Number(b[0].match(/sheet(\d+)\.xml/i)?.[1] ?? 0)
      return na - nb
    })

  const out: string[] = []
  let totalLen = 0
  let truncatedByRows = false
  let truncatedByChars = false

  for (let idx = 0; idx < sheetEntries.length; idx++) {
    const [, xml] = sheetEntries[idx]
    const label = sheetNames[idx] || `Sheet${idx + 1}`
    const rows: string[] = []
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g
    let rm: RegExpExecArray | null
    while ((rm = rowRegex.exec(xml)) !== null) {
      if (rows.length >= 40) {
        truncatedByRows = true
        break
      }
      const cells: string[] = []
      const cRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g
      let cm: RegExpExecArray | null
      while ((cm = cRegex.exec(rm[1])) !== null) {
        const attrs = cm[1]
        const body = cm[2]
        const tType = attrs.match(/\bt="([^"]+)"/)?.[1] ?? ''
        let val = ''
        if (tType === 's') {
          const idxStr = body.match(/<v>([^<]*)<\/v>/)?.[1]
          if (idxStr !== undefined) val = sharedStrings[Number(idxStr)] ?? ''
        } else if (tType === 'inlineStr') {
          const parts: string[] = []
          const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g
          let tm: RegExpExecArray | null
          while ((tm = tRegex.exec(body)) !== null) parts.push(decodeXmlEntities(tm[1]))
          val = parts.join('')
        } else {
          val = decodeXmlEntities(body.match(/<v>([^<]*)<\/v>/)?.[1] ?? '')
        }
        const cleaned = val.replace(/\s+/g, ' ').trim()
        if (cleaned) cells.push(cleaned)
      }
      if (cells.length > 0) rows.push(cells.join(' | '))
    }
    if (rows.length > 0) {
      const block = `[${label}]\n${rows.join('\n')}`
      out.push(block)
      totalLen += block.length
      if (totalLen >= maxChars) {
        if (idx + 1 < sheetEntries.length) truncatedByChars = true
        break
      }
    }
  }

  const text = out.join('\n\n').trim()
  if (text.length > maxChars) truncatedByChars = true
  const truncated = truncatedByRows || truncatedByChars
  let reason: string | undefined
  if (truncatedByRows && truncatedByChars) reason = '仅读取每个工作表前 40 行且已按长度截断'
  else if (truncatedByRows) reason = '仅读取每个工作表前 40 行'
  else if (truncatedByChars) reason = '表格内容较长，仅读取前段预览'
  return { text, truncated, reason }
}

function decodeZipPayload(slice: Buffer, method: number, remainingBudget: number): Buffer | null {
  if (remainingBudget <= 0) return null
  const cap = Math.min(MAX_ZIP_ENTRY_OUT, remainingBudget)
  try {
    if (method === 0) {
      if (slice.length > cap) return null
      return slice
    }
    if (method === 8) {
      return inflateRawSync(slice, { maxOutputLength: cap })
    }
  } catch {
    return null
  }
  return null
}

/**
 * Lightweight ZIP entry extractor supporting Central Directory / Data Descriptor mode and sequential header fallback,
 * enforcing per-entry and cumulative decompression budgets against zip bombs.
 */
export function readZipEntries(
  zip: Buffer,
  matcher: (name: string) => boolean,
  maxTotalOut = MAX_ZIP_TOTAL_OUT
): Map<string, string> {
  const result = new Map<string, string>()
  let remainingBudget = maxTotalOut

  const minEocd = Math.max(0, zip.length - 65557)
  for (let i = zip.length - 22; i >= minEocd; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      const cdEntries = zip.readUInt16LE(i + 10)
      let cdOffset = zip.readUInt32LE(i + 16)
      for (let e = 0; e < cdEntries && cdOffset + 46 <= zip.length; e++) {
        if (zip.readUInt32LE(cdOffset) !== 0x02014b50) break
        const method = zip.readUInt16LE(cdOffset + 10)
        const compSize = zip.readUInt32LE(cdOffset + 20)
        const nameLen = zip.readUInt16LE(cdOffset + 28)
        const extraLen = zip.readUInt16LE(cdOffset + 30)
        const commentLen = zip.readUInt16LE(cdOffset + 32)
        const localOffset = zip.readUInt32LE(cdOffset + 42)
        const name = zip.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8')
        if (matcher(name) && localOffset + 30 <= zip.length) {
          if (zip.readUInt32LE(localOffset) !== 0x04034b50) break
          const lNameLen = zip.readUInt16LE(localOffset + 26)
          const lExtraLen = zip.readUInt16LE(localOffset + 28)
          const dataStart = localOffset + 30 + lNameLen + lExtraLen
          const dataEnd = dataStart + compSize
          if (dataEnd <= zip.length) {
            const rawBuf = decodeZipPayload(zip.subarray(dataStart, dataEnd), method, remainingBudget)
            if (rawBuf !== null) {
              remainingBudget -= rawBuf.length
              result.set(name, rawBuf.toString('utf8'))
            }
          }
        }
        cdOffset += 46 + nameLen + extraLen + commentLen
      }
      return result
    }
  }

  let offset = 0
  while (offset + 30 <= zip.length) {
    const sig = zip.readUInt32LE(offset)
    if (sig !== 0x04034b50) break
    const method = zip.readUInt16LE(offset + 8)
    const compSize = zip.readUInt32LE(offset + 18)
    const nameLen = zip.readUInt16LE(offset + 26)
    const extraLen = zip.readUInt16LE(offset + 28)
    const name = zip.subarray(offset + 30, offset + 30 + nameLen).toString('utf8')
    const dataStart = offset + 30 + nameLen + extraLen
    const dataEnd = dataStart + compSize
    if (dataEnd > zip.length) break
    if (matcher(name)) {
      const rawBuf = decodeZipPayload(zip.subarray(dataStart, dataEnd), method, remainingBudget)
      if (rawBuf !== null) {
        remainingBudget -= rawBuf.length
        result.set(name, rawBuf.toString('utf8'))
      }
    }
    if (compSize === 0) break
    offset = dataEnd
  }
  return result
}

export function readZipEntryText(zip: Buffer, targetName: string): string | null {
  return readZipEntries(zip, (name) => name === targetName).get(targetName) ?? null
}

function decodeHexToUnicode(hex: string): string {
  const clean = hex.replace(/\s+/g, '')
  if (!clean || clean.length % 2 !== 0) return ''
  const bytes = Buffer.from(clean, 'hex')
  if (bytes.length === 2 || bytes.length % 2 === 0) {
    let out = ''
    for (let i = 0; i < bytes.length; i += 2) {
      const code = bytes.readUInt16BE(i)
      if (code >= 0x20 || code === 0x09 || code === 0x0a) out += String.fromCharCode(code)
    }
    if (out) return out
  }
  return bytes.toString('utf8')
}

function parseToUnicodeCMap(streamText: string, cmap: Map<string, string>): void {
  const bfcharBlocks = streamText.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []
  for (const blk of bfcharBlocks) {
    const pairRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
    let m: RegExpExecArray | null
    while ((m = pairRegex.exec(blk)) !== null) {
      const ch = decodeHexToUnicode(m[2])
      if (ch) cmap.set(m[1].toLowerCase(), ch)
    }
  }

  const bfrangeBlocks = streamText.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []
  for (const blk of bfrangeBlocks) {
    const arrRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]+)\]/g
    let am: RegExpExecArray | null
    while ((am = arrRegex.exec(blk)) !== null) {
      const start = parseInt(am[1], 16)
      const end = parseInt(am[2], 16)
      const hexLen = am[1].length
      const targets = [...am[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((t) => decodeHexToUnicode(t[1]))
      for (let i = 0; start + i <= end && i < targets.length && i < 256; i++) {
        if (targets[i]) cmap.set((start + i).toString(16).padStart(hexLen, '0').toLowerCase(), targets[i])
      }
    }
    const singleRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
    let sm: RegExpExecArray | null
    while ((sm = singleRegex.exec(blk)) !== null) {
      const start = parseInt(sm[1], 16)
      const end = parseInt(sm[2], 16)
      let dst = parseInt(sm[3], 16)
      const hexLen = sm[1].length
      for (let code = start; code <= end && code - start < 256; code++, dst++) {
        cmap.set(code.toString(16).padStart(hexLen, '0').toLowerCase(), String.fromCodePoint(dst))
      }
    }
  }
}

function decodePdfLiteralString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)))
}

function decodePdfHexOperand(hex: string, cmap: Map<string, string>): string {
  const clean = hex.replace(/\s+/g, '').toLowerCase()
  if (!clean) return ''
  if (cmap.size > 0) {
    for (const keyLen of [4, 2]) {
      if (clean.length % keyLen !== 0) continue
      let out = ''
      let matched = 0
      for (let i = 0; i < clean.length; i += keyLen) {
        const mapped = cmap.get(clean.slice(i, i + keyLen))
        if (mapped) {
          out += mapped
          matched++
        }
      }
      if (matched > 0) return out
    }
  }
  if (clean.startsWith('feff') && clean.length >= 8) {
    return decodeHexToUnicode(clean.slice(4))
  }
  const bytes = Buffer.from(clean, 'hex')
  const ascii = bytes.toString('latin1')
  return /^[\x20-\x7E\s]+$/.test(ascii) ? ascii : ''
}

function extractTextFromPdfStream(streamText: string, cmap: Map<string, string>): string[] {
  const tokens: string[] = []
  const opRegex = /(\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>)\s*(?:Tj|'|")|\[((?:[^[\]]|\[[^\]]*\])*)\]\s*TJ/g
  let m: RegExpExecArray | null
  while ((m = opRegex.exec(streamText)) !== null) {
    if (m[1]) {
      const piece = m[1].startsWith('<')
        ? decodePdfHexOperand(m[1].slice(1, -1), cmap)
        : decodePdfLiteralString(m[1].slice(1, -1))
      if (piece) tokens.push(piece)
    } else if (m[2]) {
      const inner = /\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>/g
      let im: RegExpExecArray | null
      let joined = ''
      while ((im = inner.exec(m[2])) !== null) {
        joined += im[0].startsWith('<')
          ? decodePdfHexOperand(im[0].slice(1, -1), cmap)
          : decodePdfLiteralString(im[0].slice(1, -1))
      }
      if (joined) tokens.push(joined)
    }
  }
  return tokens
}

export interface PdfExtractionResult {
  text: string
  truncated: boolean
  hasImages: boolean
}

/**
 * Extracts PDF text strictly from Tj/TJ content-stream operators and ToUnicode CMaps;
 * avoids /Info metadata literals so image-only scanned PDFs are honestly flagged rather than treated as read.
 */
export function extractPdfTextDetailed(buf: Buffer): PdfExtractionResult {
  const scanLimit = Math.min(buf.length, MAX_PDF_SCAN_BYTES)
  const scanBuf = buf.subarray(0, scanLimit)
  const decodedStreams: string[] = []
  const cmap = new Map<string, string>()

  const streamSig = Buffer.from('stream')
  const endSig = Buffer.from('endstream')
  let cursor = 0
  let totalStreams = 0
  let totalDecodedBytes = 0
  let hasImages = false
  let hitBudget = buf.length > MAX_PDF_SCAN_BYTES

  while (cursor < scanBuf.length) {
    if (totalStreams >= 256 || decodedStreams.length >= 48 || totalDecodedBytes >= MAX_PDF_TOTAL_OUT) {
      hitBudget = true
      break
    }
    const idx = scanBuf.indexOf(streamSig, cursor)
    if (idx < 0) break
    const prevByte = idx > 0 ? scanBuf[idx - 1] : 0x20
    let nlPos = idx + 6
    while (nlPos < scanBuf.length && (scanBuf[nlPos] === 0x20 || scanBuf[nlPos] === 0x09)) {
      nlPos++
    }
    const nextByte = nlPos < scanBuf.length ? scanBuf[nlPos] : 0
    if (
      (prevByte === 0x0a || prevByte === 0x0d || prevByte === 0x20 || prevByte === 0x3e) &&
      (nextByte === 0x0a || nextByte === 0x0d)
    ) {
      const dataStart = nlPos + (scanBuf[nlPos] === 0x0d && scanBuf[nlPos + 1] === 0x0a ? 2 : 1)
      const endIdx = scanBuf.indexOf(endSig, dataStart)
      if (endIdx < 0) break

      let dataEnd = endIdx
      while (dataEnd > dataStart && (scanBuf[dataEnd - 1] === 0x0a || scanBuf[dataEnd - 1] === 0x0d)) {
        dataEnd--
      }

      const dictText = scanBuf.subarray(Math.max(0, idx - 360), idx).toString('latin1')
      const isImageStream = /\/Subtype\s*\/Image\b/i.test(dictText)
      if (isImageStream) hasImages = true
      const isSkipStream = isImageStream || /\/Length1\b/i.test(dictText)

      if (!isSkipStream && dataEnd > dataStart) {
        const rawSlice = scanBuf.subarray(dataStart, dataEnd)
        const streamCap = Math.min(512 * 1024, MAX_PDF_TOTAL_OUT - totalDecodedBytes)
        let plain: Buffer | null = null
        if (streamCap > 0) {
          if (/\/FlateDecode\b|\/Fl\b/i.test(dictText)) {
            try {
              plain = inflateSync(rawSlice, { maxOutputLength: streamCap })
            } catch {
              try {
                plain = inflateRawSync(rawSlice, { maxOutputLength: streamCap })
              } catch {
                plain = null
              }
            }
          } else if (!/\/Filter\b/i.test(dictText) && rawSlice.length <= streamCap) {
            plain = rawSlice
          }
        }
        if (plain && plain.length > 0) {
          totalDecodedBytes += plain.length
          const text = plain.toString('latin1')
          if (/begincmap|beginbfchar|beginbfrange/i.test(text)) {
            parseToUnicodeCMap(text, cmap)
          } else {
            decodedStreams.push(text)
          }
        }
      }
      totalStreams++
      cursor = endIdx + endSig.length
    } else {
      cursor = idx + 6
    }
  }

  const collected: string[] = []
  for (const s of decodedStreams) {
    collected.push(...extractTextFromPdfStream(s, cmap))
  }
  let streamText = collected
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (streamText.length < 16) {
    // Fall back to plain BT ... ET blocks only when no compressed stream text was extracted
    const rawLatin = scanBuf.subarray(0, Math.min(scanBuf.length, 512 * 1024)).toString('latin1')
    const btBlocks = rawLatin.match(/\bBT\b[\s\S]{1,16000}?\bET\b/g) ?? []
    const btCollected: string[] = []
    for (const blk of btBlocks) {
      btCollected.push(...extractTextFromPdfStream(blk, cmap))
    }
    const btText = btCollected
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (btText.length >= 16) streamText = btText
  }

  return {
    text: streamText.length >= 16 ? streamText : '',
    truncated: hitBudget,
    hasImages
  }
}

export function extractPdfText(buf: Buffer): string {
  return extractPdfTextDetailed(buf).text
}

/**
 * Pure-Node text / Office / PDF / folder snippet extractor (zero Electron dependency; safe for worker threads).
 */
export async function extractDocTextOnly(item: DockItem, maxChars = 2400): Promise<ExtractedDoc> {
  const base: ExtractedDoc = {
    id: item.id,
    name: item.name,
    ext: item.ext,
    size: item.size,
    snippet: '',
    readStatus: 'meta-only'
  }
  try {
    if (item.isDir || item.ext === 'dir') {
      const entries = await fs.readdir(item.path, { withFileTypes: true })
      const visible = entries.filter((e) => !e.name.startsWith('.')).slice(0, 30)
      const list = visible.map((e) => `${e.isDirectory() ? '[目录]' : '[文件]'} ${e.name}`).join('\n')
      base.snippet = `文件夹内容（共 ${entries.length} 项）：\n${list}`.slice(0, maxChars)
      base.readStatus = 'partial'
      base.readNote =
        entries.length > 30 || base.snippet.length >= maxChars
          ? `仅列出前 ${visible.length} 个子项名称（共 ${entries.length} 项，未读取子文件正文）`
          : '仅列出目录内文件名（未读取子文件正文）'
      return base
    }

    if (TEXT_EXTS.has(item.ext)) {
      const { content, truncated } = await readTextFilePreview(item.path, 48 * 1024, { trim: true })
      if (content) {
        base.snippet = content.slice(0, maxChars)
        const isPartial = truncated || content.length > maxChars
        base.readStatus = isPartial ? 'partial' : 'full'
        if (isPartial) base.readNote = '文件较长，仅读取前段正文'
      } else {
        base.readNote = '文件内容为空'
      }
      return base
    }

    if (item.ext === 'docx') {
      const st = await fs.stat(item.path)
      if (st.size > MAX_OFFICE_INPUT_BYTES) {
        base.readNote = '文档体积超出解析上限，仅凭文件名与属性识别'
        return base
      }
      const buf = await fs.readFile(item.path)
      const xml = readZipEntryText(buf, 'word/document.xml')
      if (xml) {
        const text = stripXmlText(xml, /<\/w:p>|<w:br[^>]*\/>|<w:tab[^>]*\/>/g)
        if (text) {
          base.snippet = text.slice(0, maxChars)
          const isPartial = text.length > maxChars
          base.readStatus = isPartial ? 'partial' : 'full'
          if (isPartial) base.readNote = '文档内容较长，仅读取前段正文'
          return base
        }
      }
      base.readNote = '未能读取文档正文（文件可能受加密或超出解析上限）'
      return base
    }

    if (item.ext === 'pptx') {
      const st = await fs.stat(item.path)
      if (st.size > MAX_OFFICE_INPUT_BYTES) {
        base.readNote = '演示文稿体积超出解析上限，仅凭文件名与属性识别'
        return base
      }
      const buf = await fs.readFile(item.path)
      const entries = readZipEntries(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
      const slides = [...entries.entries()].sort((a, b) => {
        const na = Number(a[0].match(/slide(\d+)\.xml/i)?.[1] ?? 0)
        const nb = Number(b[0].match(/slide(\d+)\.xml/i)?.[1] ?? 0)
        return na - nb
      })
      const parts: string[] = []
      let total = 0
      let truncatedSlides = false
      for (let idx = 0; idx < slides.length; idx++) {
        const [name, xml] = slides[idx]
        const slideNo = name.match(/slide(\d+)\.xml/i)?.[1] ?? '?'
        const txt = stripXmlText(xml, /<\/a:p>|<a:br[^>]*\/>/g)
        if (txt) {
          const section = `[Slide ${slideNo}]\n${txt}`
          parts.push(section)
          total += section.length
          if (total >= maxChars) {
            if (idx + 1 < slides.length) truncatedSlides = true
            break
          }
        }
      }
      const joined = parts.join('\n\n').trim()
      if (joined) {
        base.snippet = joined.slice(0, maxChars)
        const isPartial = truncatedSlides || joined.length > maxChars
        base.readStatus = isPartial ? 'partial' : 'full'
        if (isPartial) base.readNote = '幻灯片较多，仅读取前几页文字'
      } else {
        base.readNote = '未能提取幻灯片文字'
      }
      return base
    }

    if (item.ext === 'xlsx') {
      const st = await fs.stat(item.path)
      if (st.size > MAX_OFFICE_INPUT_BYTES) {
        base.readNote = '表格文件体积超出解析上限，仅凭文件名与属性识别'
        return base
      }
      const buf = await fs.readFile(item.path)
      const entries = readZipEntries(
        buf,
        (n) =>
          n === 'xl/sharedStrings.xml' ||
          n === 'xl/workbook.xml' ||
          /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)
      )
      const preview = extractXlsxPreview(entries, maxChars)
      if (preview.text) {
        base.snippet = preview.text.slice(0, maxChars)
        const isPartial = preview.truncated || preview.text.length > maxChars
        base.readStatus = isPartial ? 'partial' : 'full'
        if (isPartial) base.readNote = preview.reason || '表格内容较长，仅读取前段预览'
      } else {
        base.readNote = '未能读取表格单元内容'
      }
      return base
    }

    if (item.ext === 'pdf') {
      const st = await fs.stat(item.path)
      if (st.size > MAX_PDF_INPUT_BYTES) {
        base.readNote = 'PDF 体积超出 12 MB 解析上限，仅凭文件名与属性识别'
        return base
      }
      const buf = await fs.readFile(item.path)
      const pdfRes = extractPdfTextDetailed(buf)
      if (pdfRes.text.length >= 16) {
        base.snippet = pdfRes.text.slice(0, maxChars)
        const isPartial = pdfRes.truncated || pdfRes.text.length > maxChars
        base.readStatus = isPartial ? 'partial' : 'full'
        if (isPartial) base.readNote = 'PDF 内容较长，仅读取前段正文'
      } else {
        base.readNote = pdfRes.hasImages
          ? '纯扫描件或图片型 PDF，未能识别正文文字'
          : '未能从 PDF 提取可读文字（可能为扫描件、加密或特殊编码）'
      }
      return base
    }

    if (!IMAGE_EXTS.has(item.ext)) {
      base.readNote = '暂不支持解析该格式正文，仅凭文件名与属性识别'
    }
  } catch {
    base.readNote = '读取文件失败，原文件可能已移动或无访问权限'
  }
  return base
}
