import { describe, expect, it } from 'vitest'
import { getParcelKindForExt } from './parcelKind'

describe('getParcelKindForExt', () => {
  it('文档类映射为卷轴 scroll', () => {
    expect(getParcelKindForExt('docx')).toBe('scroll')
    expect(getParcelKindForExt('.PDF')).toBe('scroll')
    expect(getParcelKindForExt('pptx')).toBe('scroll')
    expect(getParcelKindForExt('xlsx')).toBe('scroll')
  })

  it('图片、音视频与压缩包映射为纸箱 box', () => {
    expect(getParcelKindForExt('png')).toBe('box')
    expect(getParcelKindForExt('JPG')).toBe('box')
    expect(getParcelKindForExt('zip')).toBe('box')
    expect(getParcelKindForExt('mp4')).toBe('box')
  })

  it('代码、文本及未知扩展名映射为信封 envelope', () => {
    expect(getParcelKindForExt('md')).toBe('envelope')
    expect(getParcelKindForExt('ts')).toBe('envelope')
    expect(getParcelKindForExt('txt')).toBe('envelope')
    expect(getParcelKindForExt('')).toBe('envelope')
  })
})
