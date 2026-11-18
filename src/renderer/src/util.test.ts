import { describe, expect, it } from 'vitest'
import type { DockItem } from '../../shared/types'
import {
  describeResult,
  formatDurationMmSs,
  resolveBreakdownDocIds,
  resolveOrganizeScope
} from './util'

function makeItem(id: string, name: string): DockItem {
  return {
    id,
    name,
    ext: 'md',
    path: `C:\\docs\\${name}`,
    sourcePath: `C:\\docs\\${name}`,
    isCopy: false,
    size: 100,
    mtimeMs: 0,
    addedAt: 0
  }
}

describe('AI scope selection helpers', () => {
  it('returns an empty array in resolveBreakdownDocIds when no docs are explicitly checked', () => {
    expect(resolveBreakdownDocIds(new Set())).toEqual([])
    expect(resolveBreakdownDocIds(new Set(['a', 'b']))).toEqual(['a', 'b'])
  })

  it('prioritizes selected items, then filtered items on non-empty search, then all items in resolveOrganizeScope', () => {
    const a = makeItem('1', 'math.md')
    const b = makeItem('2', 'invoice.pdf')
    const c = makeItem('3', 'math-notes.md')

    expect(
      resolveOrganizeScope({
        items: [a, b, c],
        filteredItems: [a, c],
        selected: new Set(['2']),
        query: 'math'
      })
    ).toEqual({ targetIds: ['2'], count: 1, mode: 'selected' })

    expect(
      resolveOrganizeScope({
        items: [a, b, c],
        filteredItems: [a, c],
        selected: new Set(),
        query: 'math'
      })
    ).toEqual({ targetIds: ['1', '3'], count: 2, mode: 'filtered' })

    expect(
      resolveOrganizeScope({
        items: [a, b, c],
        filteredItems: [a, b, c],
        selected: new Set(),
        query: ''
      })
    ).toEqual({ targetIds: undefined, count: 3, mode: 'all' })
  })

  it('formats countdown milliseconds with ceiling seconds and clamps negatives', () => {
    expect(formatDurationMmSs(0)).toBe('00:00')
    expect(formatDurationMmSs(900)).toBe('00:01')
    expect(formatDurationMmSs(5 * 60 * 1000)).toBe('05:00')
  })

  it('formats AddResult notices in Simplified Chinese and English', () => {
    expect(describeResult({ added: 2, skipped: 1, errors: [] }, 'zh-CN')).toBe(
      '收到 2 个文件，1 个已在码头'
    )
    expect(describeResult({ added: 2, skipped: 1, errors: [] }, 'en')).toBe(
      'Staged 2 files, 1 already docked'
    )
    expect(describeResult({ added: 0, skipped: 1, errors: [] }, 'en')).toBe(
      'This file is already on the pier'
    )
    expect(describeResult({ added: 0, skipped: 0, errors: [] }, 'en')).toBeNull()
  })
})
