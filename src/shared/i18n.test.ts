import { describe, expect, it } from 'vitest'
import { describeAiProvider, getAiPresets } from './aiProvider'
import { DEFAULT_LOCALE, getMessages, resolveLocale } from './i18n'

function collectLeafPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string' || typeof obj === 'function') {
    return [prefix]
  }
  if (Array.isArray(obj)) {
    return obj.flatMap((v, idx) => collectLeafPaths(v, `${prefix}[${idx}]`))
  }
  if (obj && typeof obj === 'object') {
    return Object.entries(obj as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([k, v]) => collectLeafPaths(v, prefix ? `${prefix}.${k}` : k))
  }
  return []
}

function getValueAtPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    const arrMatch = /^([^[]+)\[(\d+)\]$/.exec(part)
    if (arrMatch) {
      cur = (cur as Record<string, unknown[]>)[arrMatch[1]][Number(arrMatch[2])]
    } else {
      cur = (cur as Record<string, unknown>)[part]
    }
  }
  return cur
}

describe('i18n dictionary & provider locale helpers', () => {
  it('resolves valid locales and falls back to DEFAULT_LOCALE', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN')
    expect(resolveLocale(undefined)).toBe('zh-CN')
    expect(resolveLocale('fr')).toBe('zh-CN')
    expect(resolveLocale('zh-CN')).toBe('zh-CN')
    expect(resolveLocale('en')).toBe('en')
  })

  it('maintains identical key structures and non-empty strings across zh-CN and en', () => {
    const zh = getMessages('zh-CN')
    const en = getMessages('en')
    const zhPaths = collectLeafPaths(zh)
    const enPaths = collectLeafPaths(en)

    expect(enPaths).toEqual(zhPaths)

    for (const p of zhPaths) {
      const zhVal = getValueAtPath(zh, p)
      const enVal = getValueAtPath(en, p)
      expect(typeof enVal).toBe(typeof zhVal)
      if (typeof zhVal === 'string' && typeof enVal === 'string') {
        expect(zhVal.trim().length, `empty zh-CN value at ${p}`).toBeGreaterThan(0)
        expect(enVal.trim().length, `empty en value at ${p}`).toBeGreaterThan(0)
      }
    }

    expect(zh.dockService.quotaExceeded(512, 'a.zip')).toContain('512 MB')
    expect(en.dockService.quotaExceeded(512, 'a.zip')).toBe(
      'Copy quota exceeded (limit 512 MB): a.zip'
    )
    expect(en.result.added(1)).toBe('Staged 1 file')
    expect(en.result.added(3)).toBe('Staged 3 files')
  })

  it('localizes AI presets and provider labels', () => {
    const zhPresets = getAiPresets('zh-CN')
    const enPresets = getAiPresets('en')
    expect(zhPresets.length).toBe(enPresets.length)
    expect(enPresets.some((p) => p.label.includes('Ollama'))).toBe(true)

    expect(describeAiProvider('http://localhost:11434/v1', 'zh-CN')).toBe('Ollama (本地)')
    expect(describeAiProvider('http://localhost:11434/v1', 'en')).toBe('Ollama (Local)')
    expect(describeAiProvider('', 'en')).toBe('DeepSeek')
  })
})
