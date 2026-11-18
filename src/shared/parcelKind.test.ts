import { describe, expect, it } from 'vitest'
import { getParcelKindForExt } from './parcelKind'

describe('getParcelKindForExt', () => {
  it('maps document formats to scroll parcels', () => {
    expect(getParcelKindForExt('docx')).toBe('scroll')
    expect(getParcelKindForExt('.PDF')).toBe('scroll')
    expect(getParcelKindForExt('pptx')).toBe('scroll')
    expect(getParcelKindForExt('xlsx')).toBe('scroll')
  })

  it('maps images, media, and archives to box parcels', () => {
    expect(getParcelKindForExt('png')).toBe('box')
    expect(getParcelKindForExt('JPG')).toBe('box')
    expect(getParcelKindForExt('zip')).toBe('box')
    expect(getParcelKindForExt('mp4')).toBe('box')
  })

  it('maps code, plain text, and unknown extensions to envelope parcels', () => {
    expect(getParcelKindForExt('md')).toBe('envelope')
    expect(getParcelKindForExt('ts')).toBe('envelope')
    expect(getParcelKindForExt('txt')).toBe('envelope')
    expect(getParcelKindForExt('')).toBe('envelope')
  })
})
