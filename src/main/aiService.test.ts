import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { deflateRawSync, deflateSync } from 'zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  breakdownFocusGoal,
  decodeTextBuffer,
  extractFilesBatch,
  extractFileSnippet,
  extractPdfText,
  isAbortError,
  mapOrganizeResponse,
  parseJsonLoose,
  readTextFilePreview,
  readZipEntryText,
  requiresApiKey,
  summarizeDocumentsTogether,
  type ExtractedDoc
} from './aiService'

function buildSimpleZip(entries: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const dataBuf = deflateRawSync(Buffer.from(e.content, 'utf8'))

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(0x0008, 6)
    lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(0, 18)
    lh.writeUInt16LE(nameBuf.length, 26)
    const local = Buffer.concat([lh, nameBuf, dataBuf])
    locals.push(local)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(dataBuf.length, 20)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([cd, nameBuf]))
    offset += local.length
  }
  const cdAll = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdAll.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cdAll, eocd])
}

describe('parseJsonLoose', () => {
  it('解析带 markdown 代码块的 JSON', () => {
    const raw = '```json\n{"reply": "你好呀~"}\n```'
    expect(parseJsonLoose<{ reply: string }>(raw).reply).toBe('你好呀~')
  })

  it('解析前后夹杂说明文字的 JSON', () => {
    const raw = '好的，这是整理结果：\n{"otterBubble":"分好啦","items":[]}\n希望对你有帮助'
    const res = parseJsonLoose<{ otterBubble: string; items: unknown[] }>(raw)
    expect(res.otterBubble).toBe('分好啦')
    expect(res.items).toEqual([])
  })
})

describe('readZipEntryText (Central Directory + Data Descriptor support)', () => {
  it('即使 Local Header 中 compSize=0（Data Descriptor 模式），仍能通过 Central Directory 正确读取', () => {
    const entry1Name = Buffer.from('[Content_Types].xml', 'utf8')
    const entry1Data = deflateRawSync(Buffer.from('<Types/>', 'utf8'))
    const entry2Name = Buffer.from('word/document.xml', 'utf8')
    const entry2Data = deflateRawSync(Buffer.from('<w:p>停靠岛测试正文</w:p>', 'utf8'))

    // 构造带 Data Descriptor（Local Header 里 compSize 填 0）的两个条目
    const makeLocal = (name: Buffer, data: Buffer): Buffer => {
      const h = Buffer.alloc(30)
      h.writeUInt32LE(0x04034b50, 0)
      h.writeUInt16LE(0x0008, 6) // bit 3: data descriptor
      h.writeUInt16LE(8, 8) // deflate
      h.writeUInt32LE(0, 18) // compSize = 0 in local header!
      h.writeUInt16LE(name.length, 26)
      return Buffer.concat([h, name, data])
    }

    const local1 = makeLocal(entry1Name, entry1Data)
    const local2 = makeLocal(entry2Name, entry2Data)
    const offset1 = 0
    const offset2 = local1.length

    const makeCentral = (name: Buffer, compSize: number, localOff: number): Buffer => {
      const c = Buffer.alloc(46)
      c.writeUInt32LE(0x02014b50, 0)
      c.writeUInt16LE(8, 10)
      c.writeUInt32LE(compSize, 20)
      c.writeUInt16LE(name.length, 28)
      c.writeUInt32LE(localOff, 42)
      return Buffer.concat([c, name])
    }

    const cd1 = makeCentral(entry1Name, entry1Data.length, offset1)
    const cd2 = makeCentral(entry2Name, entry2Data.length, offset2)
    const cdOffset = local1.length + local2.length
    const cdSize = cd1.length + cd2.length

    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(2, 8)
    eocd.writeUInt16LE(2, 10)
    eocd.writeUInt32LE(cdSize, 12)
    eocd.writeUInt32LE(cdOffset, 16)

    const zip = Buffer.concat([local1, local2, cd1, cd2, eocd])
    expect(readZipEntryText(zip, 'word/document.xml')).toBe('<w:p>停靠岛测试正文</w:p>')
  })
})

describe('decodeTextBuffer & mapOrganizeResponse', () => {
  it('正确解码 UTF-8 BOM 与 UTF-16LE BOM 文本', () => {
    const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('停靠岛日记', 'utf8')])
    expect(decodeTextBuffer(utf8Bom)).toBe('停靠岛日记')

    const utf16Bom = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Windows 记事本内容', 'utf16le')
    ])
    expect(decodeTextBuffer(utf16Bom)).toBe('Windows 记事本内容')
  })

  it('默认保留前导缩进、空行与末尾换行，避免复制代码时失真', async () => {
    const pyCode = '    def hello():\n\n        return "world"\n'
    expect(decodeTextBuffer(Buffer.from(pyCode, 'utf8'))).toBe(pyCode)
    expect(decodeTextBuffer(Buffer.from(pyCode, 'utf8'), { trim: true })).toBe(
      'def hello():\n\n        return "world"'
    )

    const dir = mkdtempSync(join(tmpdir(), 'pocket-isle-indent-'))
    try {
      const p = join(dir, 'sample.py')
      writeFileSync(p, pyCode, 'utf8')
      const preview = await readTextFilePreview(p)
      expect(preview.content).toBe(pyCode)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AI 返回未匹配任何文件 ID 时应返回 ok:false，避免误报成功', () => {
    const docs: ExtractedDoc[] = [
      { id: 'doc-1', name: 'plan.md', ext: 'md', size: 120, snippet: 'hello', readStatus: 'full' }
    ]
    const empty = mapOrganizeResponse(docs, { items: [{ id: 'wrong-id', group: '文档', brief: 'x' }] })
    expect(empty.result.ok).toBe(false)
    expect(empty.updates.size).toBe(0)

    const matched = mapOrganizeResponse(docs, {
      otterBubble: '整理好啦',
      items: [{ id: 'doc-1', group: '项目文档', brief: '计划说明', bullets: ['要点A'] }]
    })
    expect(matched.result.ok).toBe(true)
    expect(matched.updates.get('doc-1')?.group).toBe('项目文档')
  })
})

describe('extractPdfText (FlateDecode + ToUnicode CMap)', () => {
  it('能解压 FlateDecode PDF 内容流并提取英文 Tj 文本', () => {
    const comp = deflateSync(Buffer.from('BT (Hello Pocket Isle Desktop Dock!) Tj ET', 'latin1'))
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
      comp,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')
    ])
    expect(extractPdfText(pdf)).toContain('Hello Pocket Isle Desktop Dock!')
  })

  it('能解析 ToUnicode CMap（含 bfchar 与数组 bfrange）并还原 FlateDecode 中文 PDF', () => {
    const cmap = deflateSync(
      Buffer.from(
        'begincmap\n2 beginbfchar\n<0001> <505C>\n<0002> <9760>\nendbfchar\n1 beginbfrange\n<0003> <0004> [<5C9B> <4E36>]\nendbfrange\nendcmap',
        'latin1'
      )
    )
    const content = deflateSync(
      Buffer.from('BT [<000100020003> -12 ( Isle Report Summary)] TJ ET', 'latin1')
    )
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
      cmap,
      Buffer.from('\nendstream\n2 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
      content,
      Buffer.from('\nendstream\n%%EOF', 'latin1')
    ])
    const extracted = extractPdfText(pdf)
    expect(extracted).toContain('停靠岛')
    expect(extracted).toContain('Isle Report Summary')
  })
})

describe('extractFileSnippet (.pptx / .xlsx / Vision) & requiresApiKey', () => {
  it('能提取 .pptx 每页幻灯片文字以及 .xlsx 表头与行数据', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pocket-isle-test-'))
    try {
      const pptxPath = join(dir, 'deck.pptx')
      writeFileSync(
        pptxPath,
        buildSimpleZip([
          { name: 'ppt/slides/slide2.xml', content: '<p:sld><a:p><a:t>第二页总结</a:t></a:p></p:sld>' },
          { name: 'ppt/slides/slide1.xml', content: '<p:sld><a:p><a:t>第一页标题</a:t></a:p></p:sld>' }
        ])
      )
      const pptxDoc = await extractFileSnippet({
        id: '1',
        name: 'deck.pptx',
        ext: 'pptx',
        path: pptxPath,
        sourcePath: pptxPath,
        isCopy: false,
        size: 1024,
        mtimeMs: 0,
        addedAt: 0
      })
      expect(pptxDoc.readStatus).toBe('full')
      expect(pptxDoc.snippet).toContain('[Slide 1]\n第一页标题')
      expect(pptxDoc.snippet.indexOf('[Slide 1]')).toBeLessThan(pptxDoc.snippet.indexOf('[Slide 2]'))

      const xlsxPath = join(dir, 'budget.xlsx')
      writeFileSync(
        xlsxPath,
        buildSimpleZip([
          {
            name: 'xl/workbook.xml',
            content: '<workbook><sheets><sheet name="预算表" sheetId="1"/></sheets></workbook>'
          },
          {
            name: 'xl/sharedStrings.xml',
            content: '<sst><si><t>项目</t></si><si><t>金额</t></si><si><t>海岛茶席</t></si></sst>'
          },
          {
            name: 'xl/worksheets/sheet1.xml',
            content:
              '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>128</v></c></row></sheetData></worksheet>'
          }
        ])
      )
      const xlsxDoc = await extractFileSnippet({
        id: '2',
        name: 'budget.xlsx',
        ext: 'xlsx',
        path: xlsxPath,
        sourcePath: xlsxPath,
        isCopy: false,
        size: 1024,
        mtimeMs: 0,
        addedAt: 0
      })
      expect(xlsxDoc.readStatus).toBe('full')
      expect(xlsxDoc.snippet).toContain('[预算表]\n项目 | 金额\n海岛茶席 | 128')

      const imgPath = join(dir, 'shot.png')
      writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      const imgDoc = await extractFileSnippet(
        {
          id: '3',
          name: 'shot.png',
          ext: 'png',
          path: imgPath,
          sourcePath: imgPath,
          isCopy: false,
          size: 4,
          mtimeMs: 0,
          addedAt: 0
        },
        2400,
        { encodeImage: async () => 'data:image/jpeg;base64,ZmFrZQ==' }
      )
      expect(imgDoc.readStatus).toBe('partial')
      expect(imgDoc.imageDataUrl).toBe('data:image/jpeg;base64,ZmFrZQ==')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('本地模型地址 (Ollama / LM Studio，含省略协议) 允许不填 API Key，云端接口仍校验 Key', () => {
    expect(requiresApiKey('http://localhost:11434/v1/chat/completions')).toBe(false)
    expect(requiresApiKey('localhost:11434/v1')).toBe(false)
    expect(requiresApiKey('http://127.0.0.1:1234/v1')).toBe(false)
    expect(requiresApiKey('https://api.deepseek.com/v1')).toBe(true)
  })

  it('readTextFilePreview 与 extractFileSnippet 支持快速截断预览及文件夹清单识别', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pocket-isle-preview-'))
    try {
      const txtPath = join(dir, 'notes.md')
      writeFileSync(txtPath, '# 标题\n' + 'A'.repeat(200), 'utf8')
      const preview = await readTextFilePreview(txtPath, 40)
      expect(preview.truncated).toBe(true)
      expect(preview.content.startsWith('# 标题')).toBe(true)

      const subDir = join(dir, 'design-assets')
      mkdirSync(subDir)
      writeFileSync(join(subDir, 'spec.txt'), 'hi')
      const dirDoc = await extractFileSnippet({
        id: 'd1',
        name: 'design-assets',
        ext: 'dir',
        path: subDir,
        sourcePath: subDir,
        isCopy: false,
        isDir: true,
        size: 0,
        mtimeMs: 0,
        addedAt: 0
      })
      expect(dirDoc.readStatus).toBe('partial')
      expect(dirDoc.readNote).toContain('仅列出目录内文件名')
      expect(dirDoc.snippet).toContain('[文件] spec.txt')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('41 行 Excel 表格标为 partial 且附带仅读取前 40 行说明', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pocket-isle-xlsx41-'))
    try {
      const xlsxPath = join(dir, 'tasks.xlsx')
      const rowsXml = Array.from({ length: 41 }, (_, i) => {
        const val = i === 40 ? '周五提交实验报告' : `任务${i + 1}`
        return `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>${val}</t></is></c></row>`
      }).join('')
      writeFileSync(
        xlsxPath,
        buildSimpleZip([
          {
            name: 'xl/workbook.xml',
            content: '<workbook><sheets><sheet name="计划" sheetId="1"/></sheets></workbook>'
          },
          {
            name: 'xl/worksheets/sheet1.xml',
            content: `<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`
          }
        ])
      )
      const doc = await extractFileSnippet({
        id: 'x41',
        name: 'tasks.xlsx',
        ext: 'xlsx',
        path: xlsxPath,
        sourcePath: xlsxPath,
        isCopy: false,
        size: 2048,
        mtimeMs: 0,
        addedAt: 0
      })
      expect(doc.readStatus).toBe('partial')
      expect(doc.readNote).toContain('40 行')
      expect(doc.snippet).not.toContain('周五提交实验报告')

      const mapped = mapOrganizeResponse([doc], {
        items: [{ id: 'x41', group: '表格', brief: '任务清单' }]
      })
      expect(mapped.updates.get('x41')?.summary.readStatus).toBe('partial')
      expect(mapped.updates.get('x41')?.summary.readNote).toContain('40 行')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('纯扫描件 PDF 不把元数据括号当作正文，标记为 meta-only 并附带原因', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pocket-isle-scanpdf-'))
    try {
      const pdfPath = join(dir, 'scanned.pdf')
      const fakeScanPdf = Buffer.from(
        '%PDF-1.4\n' +
          '1 0 obj\n<< /Producer (Adobe ScanSnap Manager 15.0) /Creator (CamScanner Mobile App) /CreationDate (D:20261118120000) >>\nendobj\n' +
          '2 0 obj\n<< /Subtype /Image /Width 1200 /Height 1600 /Length 12 >>\nstream\nFAKEIMGBYTES\nendstream\nendobj\n%%EOF',
        'latin1'
      )
      writeFileSync(pdfPath, fakeScanPdf)
      expect(extractPdfText(fakeScanPdf)).toBe('')

      const doc = await extractFileSnippet({
        id: 'pdf-scan',
        name: 'scanned.pdf',
        ext: 'pdf',
        path: pdfPath,
        sourcePath: pdfPath,
        isCopy: false,
        size: fakeScanPdf.length,
        mtimeMs: 0,
        addedAt: 0
      })
      expect(doc.readStatus).toBe('meta-only')
      expect(doc.readNote).toContain('扫描')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('6 张图片联合速览时，仅编码并附带前 4 张图片，第 5～6 张在请求体与回执中均标为未附图', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pocket-isle-6imgs-'))
    try {
      const items = Array.from({ length: 6 }, (_, i) => {
        const p = join(dir, `shot-${i + 1}.png`)
        writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
        return {
          id: `img-${i + 1}`,
          name: `shot-${i + 1}.png`,
          ext: 'png',
          path: p,
          sourcePath: p,
          isCopy: false,
          size: 4,
          mtimeMs: 0,
          addedAt: 0
        }
      })

      let encodeCount = 0
      const docs = await extractFilesBatch(items, {
        enableVision: true,
        concurrency: 2,
        encodeImage: async (filePath) => {
          encodeCount++
          return `data:image/jpeg;base64,${Buffer.from(filePath).toString('base64')}`
        }
      })
      expect(encodeCount).toBe(4)
      expect(docs.filter((d) => d.attachedImage)).toHaveLength(4)
      expect(docs[4].readStatus).toBe('meta-only')
      expect(docs[4].imageDataUrl).toBeUndefined()
      expect(docs[5].readNote).toContain('4 张')

      const fetchSpy = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: '图片对比',
                  otterBubble: '看图对比好啦',
                  markdown: '### 核心结论\n已对比'
                })
              }
            }
          ]
        })
      }))
      vi.stubGlobal('fetch', fetchSpy)

      const res = await summarizeDocumentsTogether(
        {
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
          enableVision: true
        },
        docs
      )
      expect(res.ok).toBe(true)
      expect(res.files?.filter((f) => f.imageAttached)).toHaveLength(4)
      expect(res.files?.filter((f) => f.imageAttached === false)).toHaveLength(2)

      const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
      const body = JSON.parse(String(init.body)) as {
        messages: Array<{ content: Array<{ type: string }> }>
      }
      const userParts = body.messages[1].content
      expect(userParts.filter((p) => p.type === 'image_url')).toHaveLength(4)
    } finally {
      vi.unstubAllGlobals()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('批量提取遵守总字节预算并响应取消信号；模型输出畸形字段时安全清洗', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pocket-isle-batch-'))
    try {
      const f1 = join(dir, 'a.txt')
      const f2 = join(dir, 'b.txt')
      writeFileSync(f1, 'hello one')
      writeFileSync(f2, 'hello two')

      const budgetDocs = await extractFilesBatch(
        [
          {
            id: '1',
            name: 'a.txt',
            ext: 'txt',
            path: f1,
            sourcePath: f1,
            isCopy: false,
            size: 100,
            mtimeMs: 0,
            addedAt: 0
          },
          {
            id: '2',
            name: 'b.txt',
            ext: 'txt',
            path: f2,
            sourcePath: f2,
            isCopy: false,
            size: 500,
            mtimeMs: 0,
            addedAt: 0
          }
        ],
        { maxTotalInputBytes: 200 }
      )
      expect(budgetDocs[0].readStatus).toBe('full')
      expect(budgetDocs[1].readStatus).toBe('meta-only')
      expect(budgetDocs[1].readNote).toContain('预算')

      const ac = new AbortController()
      ac.abort()
      let threwAbort = false
      try {
        await extractFilesBatch([budgetDocs[0] as never], { signal: ac.signal })
      } catch (err) {
        threwAbort = isAbortError(err)
      }
      expect(threwAbort).toBe(true)

      // 畸形模型响应：brief / bullets / attention 为对象时不会透传对象给 React
      const badMapped = mapOrganizeResponse([budgetDocs[0]], {
        otterBubble: { nested: true } as unknown,
        items: [
          {
            id: '1',
            group: { g: 'x' } as unknown,
            brief: { bad: 1 } as unknown,
            bullets: ['有效要点', { obj: true }, 42] as unknown,
            attention: ['not-string'] as unknown
          }
        ]
      })
      const s = badMapped.updates.get('1')?.summary
      expect(typeof s?.brief).toBe('string')
      expect(s?.bullets).toEqual(['有效要点', '42'])
      expect(s?.attention).toBeUndefined()
      expect(typeof badMapped.result.otterBubble).toBe('string')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('专注拆解传入空资料数组时，请求体 relatedFiles 严格为空', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                refinedGoal: '复习高数第一章',
                steps: ['看例题', '做习题', '整理错题'],
                otterBubble: '一起加油~'
              })
            }
          }
        ]
      })
    }))
    vi.stubGlobal('fetch', fetchSpy)

    try {
      const res = await breakdownFocusGoal(
        {
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'sk-test-key',
          model: 'deepseek-chat'
        },
        '复习高数',
        []
      )
      expect(res.ok).toBe(true)
      const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
      const payload = JSON.parse(String(init.body)) as {
        messages: Array<{ role: string; content: string }>
      }
      const userBody = JSON.parse(payload.messages[1].content) as {
        userGoal: string
        relatedFiles: unknown[]
      }
      expect(userBody.userGoal).toBe('复习高数')
      expect(userBody.relatedFiles).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
