import { describe, expect, it } from 'vitest'
import type { DockItem } from '../../shared/types'
import { formatDurationMmSs, resolveBreakdownDocIds, resolveOrganizeScope } from './util'

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
})
