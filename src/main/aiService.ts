import { promises as fs } from 'fs'
import { inflateRawSync, inflateSync } from 'zlib'
import type {
  AiBreakdownResult,
  AiConfig,
  AiJointSummaryResult,
  AiOrganizeResult,
  DecorationId,
  DecorationState,
  DockItem,
  FileSummary
} from '../shared/types'

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

export interface ExtractedDoc {
  id: string
  name: string
  ext: string
  size: number
  snippet: string
  readStatus: 'full' | 'partial' | 'meta-only'
  imageDataUrl?: string
}

export interface ExtractSnippetOptions {
  encodeImage?: (filePath: string) => Promise<string | undefined>
}

export function decodeTextBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le').replace(/\0/g, '').trim()
  }
  const utf8 = buf.toString('utf8').replace(/\0/g, '').trim()
  return utf8.startsWith('\uFEFF') ? utf8.slice(1).trim() : utf8
}

/** 安全读取纯文本文件前置内容（最多 maxBytes 字节），供面板快速预览或复制到剪贴板 */
export async function readTextFilePreview(
  filePath: string,
  maxBytes = 64 * 1024
): Promise<{ content: string; truncated: boolean }> {
  const st = await fs.stat(filePath)
  const readSize = Math.min(st.size, maxBytes)
  if (readSize === 0) return { content: '', truncated: false }
  const fd = await fs.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(readSize)
    const { bytesRead } = await fd.read(buf, 0, readSize, 0)
    const content = decodeTextBuffer(buf.subarray(0, bytesRead))
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

function extractXlsxPreview(entries: Map<string, string>, maxChars: number): string {
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
  for (let idx = 0; idx < sheetEntries.length; idx++) {
    const [, xml] = sheetEntries[idx]
    const label = sheetNames[idx] || `Sheet${idx + 1}`
    const rows: string[] = []
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g
    let rm: RegExpExecArray | null
    while ((rm = rowRegex.exec(xml)) !== null && rows.length < 40) {
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
      if (totalLen >= maxChars) break
    }
  }
  return out.join('\n\n').trim()
}

/**
 * 从本地文件安全提取可供 AI 分析的前置文本片段（或可选压缩图片供 Vision 模型读取）：
 * - 纯文本 / 代码 / Markdown / CSV / JSON：直接按 UTF-8 / UTF-16LE 读取；
 * - .docx / .pptx / .xlsx：零重依赖解析 ZIP XML 提取正文、幻灯片文字或表头/前 40 行数据；
 * - .pdf：支持解压 FlateDecode 内容流与 ToUnicode CMap 字形映射；若为纯扫描件则回退为 meta-only；
 * - 图片：若启用 Vision 且提供编码回调，附带缩放缩略图供多模态识别。
 */
export async function extractFileSnippet(
  item: DockItem,
  maxChars = 2400,
  opts?: ExtractSnippetOptions
): Promise<ExtractedDoc> {
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
      base.readStatus = entries.length <= 30 && base.snippet.length < maxChars ? 'full' : 'partial'
      return base
    }

    if (TEXT_EXTS.has(item.ext)) {
      const { content, truncated } = await readTextFilePreview(item.path, 48 * 1024)
      if (content) {
        base.snippet = content.slice(0, maxChars)
        base.readStatus = !truncated && content.length <= maxChars ? 'full' : 'partial'
      }
      return base
    }

    if (item.ext === 'docx') {
      const buf = await fs.readFile(item.path)
      const xml = readZipEntryText(buf, 'word/document.xml')
      if (xml) {
        const text = stripXmlText(xml, /<\/w:p>|<w:br[^>]*\/>|<w:tab[^>]*\/>/g)
        if (text) {
          base.snippet = text.slice(0, maxChars)
          base.readStatus = text.length <= maxChars ? 'full' : 'partial'
        }
      }
      return base
    }

    if (item.ext === 'pptx') {
      const buf = await fs.readFile(item.path)
      const entries = readZipEntries(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
      const slides = [...entries.entries()].sort((a, b) => {
        const na = Number(a[0].match(/slide(\d+)\.xml/i)?.[1] ?? 0)
        const nb = Number(b[0].match(/slide(\d+)\.xml/i)?.[1] ?? 0)
        return na - nb
      })
      const parts: string[] = []
      let total = 0
      for (const [name, xml] of slides) {
        const slideNo = name.match(/slide(\d+)\.xml/i)?.[1] ?? '?'
        const txt = stripXmlText(xml, /<\/a:p>|<a:br[^>]*\/>/g)
        if (txt) {
          const section = `[Slide ${slideNo}]\n${txt}`
          parts.push(section)
          total += section.length
          if (total >= maxChars) break
        }
      }
      const joined = parts.join('\n\n').trim()
      if (joined) {
        base.snippet = joined.slice(0, maxChars)
        base.readStatus = joined.length <= maxChars ? 'full' : 'partial'
      }
      return base
    }

    if (item.ext === 'xlsx') {
      const buf = await fs.readFile(item.path)
      const entries = readZipEntries(
        buf,
        (n) =>
          n === 'xl/sharedStrings.xml' ||
          n === 'xl/workbook.xml' ||
          /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)
      )
      const preview = extractXlsxPreview(entries, maxChars)
      if (preview) {
        base.snippet = preview.slice(0, maxChars)
        base.readStatus = preview.length <= maxChars ? 'full' : 'partial'
      }
      return base
    }

    if (item.ext === 'pdf' && item.size <= 12 * 1024 * 1024) {
      const buf = await fs.readFile(item.path)
      const text = extractPdfText(buf)
      if (text.length >= 16) {
        base.snippet = text.slice(0, maxChars)
        base.readStatus = text.length <= maxChars ? 'full' : 'partial'
      }
      return base
    }

    if (opts?.encodeImage && IMAGE_EXTS.has(item.ext) && item.size <= 15 * 1024 * 1024) {
      const dataUrl = await opts.encodeImage(item.path)
      if (dataUrl) {
        base.imageDataUrl = dataUrl
        base.readStatus = 'partial'
      }
      return base
    }
  } catch {
    /* 读取异常时回退为 meta-only */
  }
  return base
}

function decodeZipPayload(slice: Buffer, method: number): string | null {
  try {
    if (method === 0) {
      if (slice.length > 4 * 1024 * 1024) return null
      return slice.toString('utf8')
    }
    if (method === 8) return inflateRawSync(slice, { maxOutputLength: 4 * 1024 * 1024 }).toString('utf8')
  } catch {
    return null
  }
  return null
}

/**
 * 轻量扫描 ZIP 条目并解压匹配的文件（支持 Central Directory / Data Descriptor 与顺序扫描回退）。
 */
export function readZipEntries(
  zip: Buffer,
  matcher: (name: string) => boolean
): Map<string, string> {
  const result = new Map<string, string>()
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
            const text = decodeZipPayload(zip.subarray(dataStart, dataEnd), method)
            if (text !== null) result.set(name, text)
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
      const text = decodeZipPayload(zip.subarray(dataStart, dataEnd), method)
      if (text !== null) result.set(name, text)
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
    // ToUnicode CMap 常见为 UTF-16BE
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

/**
 * 提取 PDF 文本：优先解压 FlateDecode 内容流并应用 ToUnicode CMap / Tj / TJ 操作符，
 * 若无流正文再回退扫描明文括号字面量；纯扫描图片型 PDF 返回空字符串以便标记 meta-only。
 */
export function extractPdfText(buf: Buffer): string {
  const scanBuf = buf.subarray(0, Math.min(buf.length, 6 * 1024 * 1024))
  const decodedStreams: string[] = []
  const cmap = new Map<string, string>()

  const streamSig = Buffer.from('stream')
  const endSig = Buffer.from('endstream')
  let cursor = 0
  let totalStreams = 0

  while (cursor < scanBuf.length && totalStreams < 256 && decodedStreams.length < 48) {
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
      let dataStart = nlPos + (scanBuf[nlPos] === 0x0d && scanBuf[nlPos + 1] === 0x0a ? 2 : 1)

      const endIdx = scanBuf.indexOf(endSig, dataStart)
      if (endIdx < 0) break

      let dataEnd = endIdx
      while (dataEnd > dataStart && (scanBuf[dataEnd - 1] === 0x0a || scanBuf[dataEnd - 1] === 0x0d)) {
        dataEnd--
      }

      const dictText = scanBuf
        .subarray(Math.max(0, idx - 360), idx)
        .toString('latin1')
      const isSkipStream =
        /\/Subtype\s*\/Image\b/i.test(dictText) || /\/Length1\b/i.test(dictText)

      if (!isSkipStream && dataEnd > dataStart) {
        const rawSlice = scanBuf.subarray(dataStart, dataEnd)
        let plain: Buffer | null = null
        if (/\/FlateDecode\b|\/Fl\b/i.test(dictText)) {
          try {
            plain = inflateSync(rawSlice, { maxOutputLength: 512 * 1024 })
          } catch {
            try {
              plain = inflateRawSync(rawSlice, { maxOutputLength: 512 * 1024 })
            } catch {
              plain = null
            }
          }
        } else if (!/\/Filter\b/i.test(dictText)) {
          plain = rawSlice
        }
        if (plain && plain.length > 0 && plain.length <= 512 * 1024) {
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
  const streamText = collected
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (streamText.length >= 16) return streamText
  return extractPdfPlainLiterals(buf)
}

/** 从简单未压缩 PDF 文本括号中提取可读文字（作为退路） */
function extractPdfPlainLiterals(buf: Buffer): string {
  const raw = buf.subarray(0, Math.min(buf.length, 256 * 1024)).toString('latin1')
  const matches = raw.match(/\(([^()\\]{3,120})\)/g)
  if (!matches) return ''
  return matches
    .map((m) => m.slice(1, -1))
    .filter((s) => /^[\x20-\x7E\s]+$/.test(s) && !/^(PDF|obj|endobj|stream)/i.test(s))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildEndpoint(baseUrl: string): string {
  let clean = baseUrl.trim().replace(/\/+$/, '')
  if (clean && !/^https?:\/\//i.test(clean)) {
    const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(clean)
    clean = `${isLocalHost ? 'http' : 'https'}://${clean}`
  }
  if (clean.endsWith('/chat/completions')) return clean
  return `${clean}/chat/completions`
}

export function requiresApiKey(baseUrl: string): boolean {
  try {
    const normalized = buildEndpoint(baseUrl || 'https://api.deepseek.com/v1')
    const u = new URL(normalized)
    const host = u.hostname.toLowerCase()
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '[::1]' && host !== '0.0.0.0'
  } catch {
    return true
  }
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  return (err as { name?: string }).name === 'AbortError'
}

type MultimodalPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'auto' } }

async function callChatJson<T>(
  cfg: AiConfig,
  systemPrompt: string,
  userPrompt: string,
  opts?: {
    timeoutMs?: number
    signal?: AbortSignal
    images?: Array<{ id: string; name: string; dataUrl: string }>
  }
): Promise<T> {
  const url = buildEndpoint(cfg.baseUrl || 'https://api.deepseek.com/v1')
  if (requiresApiKey(url) && !cfg.apiKey.trim()) {
    throw new Error('请先在面板右上角「⚙ 设置」中填写 API Key（本地模型如 Ollama 可留空）')
  }
  const ctrl = new AbortController()
  const onExternalAbort = (): void => ctrl.abort()
  if (opts?.signal?.aborted) {
    ctrl.abort()
  } else {
    opts?.signal?.addEventListener('abort', onExternalAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 32000)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (cfg.apiKey.trim()) {
    headers.Authorization = `Bearer ${cfg.apiKey.trim()}`
  }

  let userContent: string | MultimodalPart[] = userPrompt
  if (cfg.enableVision && opts?.images?.length) {
    const parts: MultimodalPart[] = [{ type: 'text', text: userPrompt }]
    for (const im of opts.images.slice(0, 4)) {
      parts.push({ type: 'text', text: `[附图 id=${im.id} 文件名=${im.name}]` })
      parts.push({ type: 'image_url', image_url: { url: im.dataUrl, detail: 'low' } })
    }
    userContent = parts
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model.trim() || 'deepseek-chat',
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 120) || res.statusText}`)
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!content) throw new Error('模型返回内容为空')
    return parseJsonLoose<T>(content)
  } finally {
    clearTimeout(timer)
    opts?.signal?.removeEventListener('abort', onExternalAbort)
  }
}

export function parseJsonLoose<T>(raw: string): T {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(stripped) as T
  } catch {
    const first = stripped.indexOf('{')
    const last = stripped.lastIndexOf('}')
    if (first >= 0 && last > first) {
      return JSON.parse(stripped.slice(first, last + 1)) as T
    }
    throw new Error('无法解析模型返回的 JSON 格式')
  }
}

export async function testConnection(cfg: AiConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await callChatJson<{ reply?: string }>(
      cfg,
      '你是停靠岛上的小水獭。请只返回 JSON: {"reply":"一句12字以内的打招呼"}',
      '测试连接',
      { timeoutMs: 15000 }
    )
    return { ok: true, message: `连接成功！水獭说：「${res.reply || '随时待命~'}」` }
  } catch (err) {
    return { ok: false, message: (err as Error).message || '连接失败' }
  }
}

export interface OrganizeModelResponse {
  otterBubble?: string
  items?: Array<{
    id: string
    group: string
    brief: string
    bullets?: string[]
    attention?: string
  }>
}

export function mapOrganizeResponse(
  docs: ExtractedDoc[],
  data: OrganizeModelResponse
): {
  result: AiOrganizeResult
  updates: Map<string, { group: string; summary: FileSummary }>
} {
  const updates = new Map<string, { group: string; summary: FileSummary }>()
  const docMap = new Map(docs.map((d) => [d.id, d]))
  for (const it of data.items ?? []) {
    const src = docMap.get(it.id)
    if (!src) continue
    updates.set(it.id, {
      group: (it.group || '待整理').slice(0, 12),
      summary: {
        brief: it.brief || '暂无简介',
        bullets: Array.isArray(it.bullets) ? it.bullets.slice(0, 4) : [],
        attention: it.attention || undefined,
        readStatus: src.readStatus,
        updatedAt: Date.now()
      }
    })
  }

  if (updates.size === 0) {
    return {
      result: {
        ok: false,
        message: 'AI 未能匹配到码头文件，请重试或检查模型输出'
      },
      updates
    }
  }

  return {
    result: {
      ok: true,
      message: `已整理 ${updates.size} 份文件并生成速览`,
      otterBubble: data.otterBubble || '整理好啦，点文件就能看速览~'
    },
    updates
  }
}

export async function organizeAndSummarize(
  cfg: AiConfig,
  docs: ExtractedDoc[],
  signal?: AbortSignal
): Promise<{
  result: AiOrganizeResult
  updates: Map<string, { group: string; summary: FileSummary }>
}> {
  if (docs.length === 0) {
    return {
      result: { ok: false, message: '码头还没有可整理的文件' },
      updates: new Map()
    }
  }

  const sys = `你是「停靠岛」桌面应用里的 AI 水獭搭档。用户给你一批暂存在码头的文件元信息、正文片段或附图。
请严格只输出一个 JSON 对象（不要输出任何额外说明），结构如下：
{
  "otterBubble": "16字以内的可爱简短回应，如：帮你分成2组整理好啦~",
  "items": [
    {
      "id": "原样返回文件id",
      "group": "简短中文分组名（2~6个字，同类文件归入同一组名）",
      "brief": "40字以内的文件简介（若readStatus为meta-only且无附图，必须明确说明“仅根据文件名推测：...”）",
      "bullets": ["要点1（25字内）", "要点2（25字内）"],
      "attention": "需要关注的信息或后续动作建议（30字内）"
    }
  ]
}`

  const payload = docs.map((d) => ({
    id: d.id,
    name: d.name,
    ext: d.ext,
    sizeBytes: d.size,
    readStatus: d.readStatus,
    hasAttachedImage: !!d.imageDataUrl,
    contentSnippet:
      d.snippet ||
      (d.imageDataUrl ? '（已附带图片内容，请直接识别图片要点）' : '（未能读取正文，仅凭文件名与扩展名识别）')
  }))

  const images = docs
    .filter((d): d is ExtractedDoc & { imageDataUrl: string } => !!d.imageDataUrl)
    .map((d) => ({ id: d.id, name: d.name, dataUrl: d.imageDataUrl }))

  const data = await callChatJson<OrganizeModelResponse>(
    cfg,
    sys,
    JSON.stringify(payload, null, 2),
    { signal, images }
  )

  return mapOrganizeResponse(docs, data)
}

export async function summarizeDocumentsTogether(
  cfg: AiConfig,
  docs: ExtractedDoc[],
  focusPrompt?: string,
  signal?: AbortSignal
): Promise<AiJointSummaryResult> {
  if (docs.length < 2) {
    return { ok: false, message: '请至少选中 2 个文件进行联合速览/对比' }
  }

  const sys = `你是「停靠岛」里的 AI 水獭搭档。用户选中了 ${docs.length} 个相关文件，希望你联合串读、对比异同或整合成一页行动清单。
请严格只输出 JSON（不要额外文字）：
{
  "title": "18字以内的联合汇总标题",
  "otterBubble": "15字以内的可爱反馈",
  "markdown": "使用清晰 Markdown 编写（建议包含 ### 核心结论、### 差异与互补、### 下一步行动；若有文件仅为 meta-only 且无图片，请诚实注明仅根据文件名推断）"
}`

  const context = {
    userFocus: focusPrompt?.trim() || '提炼共同核心要点、对比关键差异，并整理成下一步行动清单',
    files: docs.map((d) => ({
      id: d.id,
      name: d.name,
      ext: d.ext,
      readStatus: d.readStatus,
      hasAttachedImage: !!d.imageDataUrl,
      snippet: d.snippet.slice(0, 1400)
    }))
  }

  const images = docs
    .filter((d): d is ExtractedDoc & { imageDataUrl: string } => !!d.imageDataUrl)
    .map((d) => ({ id: d.id, name: d.name, dataUrl: d.imageDataUrl }))

  const data = await callChatJson<{
    title?: string
    otterBubble?: string
    markdown?: string
  }>(cfg, sys, JSON.stringify(context, null, 2), { timeoutMs: 40000, signal, images })

  const md = (data.markdown ?? '').trim()
  if (!md) {
    return { ok: false, message: 'AI 返回的联合汇总内容为空' }
  }
  return {
    ok: true,
    message: `已生成 ${docs.length} 份文件的联合速览卡`,
    title: data.title?.trim() || `${docs.length} 份文件联合速览`,
    markdown: md,
    otterBubble: data.otterBubble || '帮你把几份资料串起来啦~'
  }
}

export async function breakdownFocusGoal(
  cfg: AiConfig,
  goal: string,
  docs: ExtractedDoc[],
  signal?: AbortSignal,
  durationMinutes = 25
): Promise<AiBreakdownResult> {
  const mins = Math.min(Math.max(Math.round(durationMinutes || 25), 1), 180)
  const sys = `你是「停靠岛」里的 AI 水獭搭档。用户正准备开启一轮 ${mins} 分钟的专注计时。
请根据用户输入的目标和关联的码头文件摘要，建议一个适合在 ${mins} 分钟内推进的具体小目标和 3 个简短可勾选的步骤。
严格只输出 JSON：
{
  "refinedGoal": "适合${mins}分钟完成的清晰小目标（24字以内）",
  "steps": ["步骤1（22字内）", "步骤2（22字内）", "步骤3（22字内）"],
  "otterBubble": "15字以内的水獭加油短语"
}`

  const context = {
    userGoal: goal.trim() || '阅读并推进当前码头里的资料',
    relatedFiles: docs.map((d) => ({
      name: d.name,
      snippet: d.snippet.slice(0, 500)
    }))
  }

  const data = await callChatJson<{
    refinedGoal?: string
    steps?: string[]
    otterBubble?: string
  }>(cfg, sys, JSON.stringify(context), { signal })

  return {
    ok: true,
    message: '已生成本轮专注建议，你可以直接修改后开始计时',
    refinedGoal: data.refinedGoal || goal.trim(),
    steps: Array.isArray(data.steps) && data.steps.length ? data.steps.slice(0, 4) : [],
    otterBubble: data.otterBubble || '我们先从第一步开始吧！'
  }
}

export async function recommendDecoration(
  cfg: AiConfig,
  moodPrompt: string,
  signal?: AbortSignal
): Promise<{
  state: DecorationState
  otterBubble: string
  reason: string
}> {
  const sys = `你是停靠岛上的小水獭。岛上有6件预设装饰：flowers(野花), bench(长椅), lamp(小路灯), tree(小树), cabin(小木屋), windmill(小风车)，以及氛围 ambience("day"晴天 / "night"微夜 / "rain"细雨)。
请根据用户想要的心情或风格，推荐一套搭配。只输出 JSON：
{
  "ambience": "day 或 night 或 rain",
  "enabled": ["flowers", "lamp", ...],
  "otterBubble": "15字以内的布置感言",
  "reason": "25字以内的搭配说明"
}`
  const data = await callChatJson<{
    ambience?: 'day' | 'night' | 'rain'
    enabled?: DecorationId[]
    otterBubble?: string
    reason?: string
  }>(cfg, sys, moodPrompt.trim() || '清爽安静的工作陪伴风格', { signal })

  const set = new Set(data.enabled ?? ['flowers', 'bench', 'tree'])
  const all: DecorationId[] = ['flowers', 'bench', 'lamp', 'tree', 'cabin', 'windmill']
  const enabled = Object.fromEntries(all.map((k) => [k, set.has(k)])) as Record<
    DecorationId,
    boolean
  >
  const ambience =
    data.ambience === 'night' || data.ambience === 'rain' ? data.ambience : 'day'
  return {
    state: {
      ambience,
      enabled
    },
    otterBubble: data.otterBubble || '帮你换好新布置啦~',
    reason: data.reason || '已应用推荐布置'
  }
}
