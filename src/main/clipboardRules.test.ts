import { describe, expect, it } from 'vitest'
import { buildClipboardFilename } from './clipboardRules'

describe('buildClipboardFilename', () => {
  const fixed = new Date(2026, 10, 17, 19, 12, 5)

  it('formats screenshot clipboard entries as timestamped .png filenames', () => {
    expect(buildClipboardFilename('image', undefined, fixed)).toBe('截图_20261117_191205.png')
  })

  it('extracts sanitized first-line text into readable note .txt filenames', () => {
    expect(buildClipboardFilename('text', '\n  TypeError: "x" / y?\nmore', fixed)).toBe(
      '便签_TypeError x y_191205.txt'
    )
    expect(buildClipboardFilename('text', '   \n***   ', fixed)).toBe('便签_20261117_191205.txt')
  })

  it('supports English screenshot and note filename prefixes', () => {
    expect(buildClipboardFilename('image', undefined, fixed, 'en')).toBe(
      'Screenshot_20261117_191205.png'
    )
    expect(buildClipboardFilename('text', 'Meeting Agenda', fixed, 'en')).toBe(
      'Note_Meeting Agenda_191205.txt'
    )
  })
})
