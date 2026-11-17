import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { deflateRawSync, deflateSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import {
  decodeTextBuffer,
  extractFileSnippet,
  extractPdfText,
  mapOrganizeResponse,
  parseJsonLoose,
  readZipEntryText,
  requiresApiKey,
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
})
