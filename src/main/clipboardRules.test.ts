import { describe, expect, it } from 'vitest'
import { buildClipboardFilename } from './clipboardRules'

describe('buildClipboardFilename', () => {
  const fixed = new Date(2026, 10, 17, 19, 12, 5)

  it('截图生成带日期时间的 .png 文件名', () => {
    expect(buildClipboardFilename('image', undefined, fixed)).toBe('截图_20261117_191205.png')
  })

  it('文本提取首行安全字符作为可读摘要文件名', () => {
    expect(buildClipboardFilename('text', '\n  TypeError: "x" / y?\nmore', fixed)).toBe(
      '便签_TypeError x y_191205.txt'
    )
    expect(buildClipboardFilename('text', '   \n***   ', fixed)).toBe('便签_20261117_191205.txt')
  })
})
