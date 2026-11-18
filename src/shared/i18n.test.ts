import { describe, expect, it } from 'vitest'
import { describeAiProvider, getAiPresets } from './aiProvider'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, getMessages, isSupportedLocale, resolveLocale } from './i18n'

function collectLeafPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string' || typeof obj === 'function' || typeof obj === 'number') {
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
  it('resolves all supported locales and falls back to DEFAULT_LOCALE', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN')
    expect(SUPPORTED_LOCALES.map((l) => l.id)).toEqual([
      'zh-CN',
      'zh-TW',
      'en',
      'ja',
      'ko',
      'es'
    ])
    expect(resolveLocale(undefined)).toBe('zh-CN')
    expect(resolveLocale('fr')).toBe('zh-CN')
    expect(isSupportedLocale('fr')).toBe(false)
    for (const loc of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(loc.id)).toBe(true)
      expect(resolveLocale(loc.id)).toBe(loc.id)
    }
  })

  it('maintains identical key structures and non-empty strings across all 6 locales', () => {
    const base = getMessages('zh-CN')
    const basePaths = collectLeafPaths(base)

    for (const loc of SUPPORTED_LOCALES) {
      const dict = getMessages(loc.id)
      const paths = collectLeafPaths(dict)
      expect(paths, `key mismatch for locale ${loc.id}`).toEqual(basePaths)

      for (const p of basePaths) {
        const baseVal = getValueAtPath(base, p)
        const val = getValueAtPath(dict, p)
        expect(typeof val, `type mismatch at ${loc.id}.${p}`).toBe(typeof baseVal)
        if (typeof val === 'string') {
          expect(val.trim().length, `empty string at ${loc.id}.${p}`).toBeGreaterThan(0)
        } else if (typeof val === 'number') {
          expect(val, `positive number expected at ${loc.id}.${p}`).toBeGreaterThan(0)
        }
      }

      expect(dict.dockService.quotaExceeded(512, 'a.zip')).toContain('512 MB')
      expect(dict.ai.prompts.jointSystem(3)).toContain('3')
      expect(dict.ai.prompts.breakdownSystem(25)).toContain('25')
      expect(dict.panel.tabs.dock(4)).toContain('4')
    }

    const en = getMessages('en')
    expect(en.result.added(1)).toBe('Staged 1 file')
    expect(en.result.added(3)).toBe('Staged 3 files')
  })

  it('localizes AI presets and provider labels across all locales', () => {
    const baseLen = getAiPresets('zh-CN').length
    for (const loc of SUPPORTED_LOCALES) {
      const presets = getAiPresets(loc.id)
      expect(presets.length).toBe(baseLen)
      expect(presets.some((p) => p.label.includes('Ollama'))).toBe(true)
      expect(describeAiProvider('', loc.id)).toBe('DeepSeek')
      expect(describeAiProvider('http://localhost:11434/v1', loc.id)).toContain('Ollama')
    }

    expect(describeAiProvider('http://localhost:11434/v1', 'zh-CN')).toBe('Ollama (本地)')
    expect(describeAiProvider('http://localhost:11434/v1', 'zh-TW')).toBe('Ollama (本機)')
    expect(describeAiProvider('http://localhost:11434/v1', 'en')).toBe('Ollama (Local)')
    expect(describeAiProvider('http://localhost:11434/v1', 'ja')).toBe('Ollama (ローカル)')
    expect(describeAiProvider('http://localhost:11434/v1', 'ko')).toBe('Ollama (로컬)')
    expect(describeAiProvider('http://localhost:11434/v1', 'es')).toBe('Ollama (Local)')
  })
})
