import { describe, expect, it } from 'vitest'
import {
  chooseDropEffect,
  extractPathsFromDataTransfer,
  parseFileUri,
  parseLocalPathCandidate,
  type DataTransferLike
} from './dropPaths'

function fakeDt(
  data: Record<string, string>,
  files: Array<{ name: string; path?: string }> = []
): { dt: DataTransferLike; getPath: (f: File) => string } {
  return {
    dt: {
      files: files as unknown as ArrayLike<File>,
      getData: (fmt: string) => data[fmt] ?? ''
    },
    getPath: (f: File) => (f as unknown as { path?: string }).path ?? ''
  }
}

describe('dropPaths (URI / IDE / Explorer drag-in parsing)', () => {
  it('parses file:/// URIs (including spaces, Unicode, encoded %3A) and UNC paths', () => {
    expect(parseFileUri('file:///D:/Pocket%20Isle/PROJECT_HANDOFF.md')).toBe(
      'D:\\Pocket Isle\\PROJECT_HANDOFF.md'
    )
    expect(parseFileUri('file:///d%3A/Pocket%20Isle/%E5%81%9C%E9%9D%A0%E5%B2%9B.md')).toBe(
      'd:\\Pocket Isle\\停靠岛.md'
    )
    expect(parseFileUri('file://localhost/C:/Users/me/a.txt')).toBe('C:\\Users\\me\\a.txt')
    expect(parseFileUri('file://nas/share/doc.pdf')).toBe('\\\\nas\\share\\doc.pdf')
    expect(parseFileUri('https://example.com/a.pdf')).toBeNull()
  })

  it('prefers native File entries and falls back to ResourceURLs / uri-list / html / plain text', () => {
    const native = fakeDt(
      { 'text/plain': 'ignore.txt' },
      [{ name: 'a.txt', path: 'D:\\a.txt' }]
    )
    expect(extractPathsFromDataTransfer(native.dt, native.getPath)).toEqual(['D:\\a.txt'])

    const ideTab = fakeDt({
      ResourceURLs: JSON.stringify(['file:///d%3A/Pocket%20Isle/PROJECT_HANDOFF.md'])
    })
    expect(extractPathsFromDataTransfer(ideTab.dt, ideTab.getPath)).toEqual([
      'd:\\Pocket Isle\\PROJECT_HANDOFF.md'
    ])

    const linkPill = fakeDt({
      'text/uri-list': '# comment\r\nfile:///D:/Pocket%20Isle/PROJECT_HANDOFF.md\r\n',
      'text/html': '<a href="file:///D:/Pocket%20Isle/PROJECT_HANDOFF.md">PROJECT_HANDOFF.md</a>'
    })
    expect(extractPathsFromDataTransfer(linkPill.dt, linkPill.getPath)).toEqual([
      'D:\\Pocket Isle\\PROJECT_HANDOFF.md'
    ])

    const plainPath = fakeDt({
      'text/plain': '"d:\\Pocket Isle\\PROJECT_HANDOFF.md"\nhttps://example.com'
    })
    expect(extractPathsFromDataTransfer(plainPath.dt, plainPath.getPath)).toEqual([
      'd:\\Pocket Isle\\PROJECT_HANDOFF.md'
    ])
  })

  it('rejects relative paths and HTTP URLs as local files', () => {
    expect(parseLocalPathCandidate('PROJECT_HANDOFF.md')).toBeNull()
    expect(parseLocalPathCandidate('https://github.com/test')).toBeNull()
  })

  it('negotiates dropEffect based on source effectAllowed', () => {
    expect(chooseDropEffect('all')).toBe('copy')
    expect(chooseDropEffect('copyLink')).toBe('copy')
    expect(chooseDropEffect('link')).toBe('link')
    expect(chooseDropEffect('move')).toBe('move')
  })
})
