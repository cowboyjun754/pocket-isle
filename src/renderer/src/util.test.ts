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
  it('专注页未勾选任何文件时，resolveBreakdownDocIds 返回空数组而非自动附带最近文件', () => {
    expect(resolveBreakdownDocIds(new Set())).toEqual([])
    expect(resolveBreakdownDocIds(new Set(['a', 'b']))).toEqual(['a', 'b'])
  })

  it('码头 AI 整理优先发送已勾选条目，搜索过滤且零勾选时仅发送筛选出的条目', () => {
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

  it('formatDurationMmSs 正确向上取整到秒并处理边界值', () => {
    expect(formatDurationMmSs(0)).toBe('00:00')
    expect(formatDurationMmSs(900)).toBe('00:01')
    expect(formatDurationMmSs(5 * 60 * 1000)).toBe('05:00')
  })
})
