import { describe, expect, it } from 'vitest'
import type { Settings } from '../shared/types'
import {
  COPY_LIMIT_MAX_MB,
  COPY_LIMIT_MIN_MB,
  FOCUS_MAX_MINUTES,
  FOCUS_MIN_MINUTES,
  REST_MAX_MINUTES,
  REST_MIN_MINUTES,
  applySettingsPatch
} from './settingsRules'

const BASE: Settings = {
  alwaysOnTop: true,
  openAtLogin: false,
  copyLimitMB: 2048,
  ai: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
}

describe('applySettingsPatch', () => {
  it('clamps copyLimitMB within valid bounds and rounds decimals', () => {
    expect(applySettingsPatch(BASE, { copyLimitMB: 10 }, false).next.copyLimitMB).toBe(
      COPY_LIMIT_MIN_MB
    )
    expect(applySettingsPatch(BASE, { copyLimitMB: 99999 }, false).next.copyLimitMB).toBe(
      COPY_LIMIT_MAX_MB
    )
    expect(applySettingsPatch(BASE, { copyLimitMB: 512.6 }, false).next.copyLimitMB).toBe(513)
    expect(applySettingsPatch(BASE, { copyLimitMB: Number.NaN }, false).next.copyLimitMB).toBe(2048)
  })

  it('ignores openAtLogin changes when unpackaged and allows them when packaged', () => {
    const dev = applySettingsPatch(BASE, { openAtLogin: true }, false)
    expect(dev.next.openAtLogin).toBe(false)
    expect(dev.openAtLoginChanged).toBe(false)

    const prod = applySettingsPatch(BASE, { openAtLogin: true }, true)
    expect(prod.next.openAtLogin).toBe(true)
    expect(prod.openAtLoginChanged).toBe(true)
  })

  it('tracks alwaysOnTopChanged accurately', () => {
    const off = applySettingsPatch(BASE, { alwaysOnTop: false }, false)
    expect(off.next.alwaysOnTop).toBe(false)
    expect(off.alwaysOnTopChanged).toBe(true)

    const same = applySettingsPatch(BASE, { alwaysOnTop: true }, false)
    expect(same.alwaysOnTopChanged).toBe(false)
  })

  it('validates and clamps focusMinutes, restMinutes, and focusNotify', () => {
    expect(applySettingsPatch(BASE, { focusMinutes: 0 }, false).next.focusMinutes).toBe(
      FOCUS_MIN_MINUTES
    )
    expect(applySettingsPatch(BASE, { focusMinutes: 300 }, false).next.focusMinutes).toBe(
      FOCUS_MAX_MINUTES
    )
    expect(applySettingsPatch(BASE, { focusMinutes: 45.4 }, false).next.focusMinutes).toBe(45)

    expect(applySettingsPatch(BASE, { restMinutes: -5 }, false).next.restMinutes).toBe(
      REST_MIN_MINUTES
    )
    expect(applySettingsPatch(BASE, { restMinutes: 120 }, false).next.restMinutes).toBe(
      REST_MAX_MINUTES
    )
    expect(applySettingsPatch(BASE, { restMinutes: 12 }, false).next.restMinutes).toBe(12)

    expect(applySettingsPatch(BASE, { focusNotify: false }, false).next.focusNotify).toBe(false)
  })

  it('validates supported locale updates and tracks localeChanged', () => {
    const toEn = applySettingsPatch(BASE, { locale: 'en' }, false)
    expect(toEn.next.locale).toBe('en')
    expect(toEn.localeChanged).toBe(true)

    const sameEn = applySettingsPatch(toEn.next, { locale: 'en' }, false)
    expect(sameEn.localeChanged).toBe(false)

    const toJa = applySettingsPatch(toEn.next, { locale: 'ja' }, false)
    expect(toJa.next.locale).toBe('ja')
    expect(toJa.localeChanged).toBe(true)

    const toEs = applySettingsPatch(toJa.next, { locale: 'es' }, false)
    expect(toEs.next.locale).toBe('es')
    expect(toEs.localeChanged).toBe(true)

    const toZhTw = applySettingsPatch(toEs.next, { locale: 'zh-TW' }, false)
    expect(toZhTw.next.locale).toBe('zh-TW')
    expect(toZhTw.localeChanged).toBe(true)

    const toKo = applySettingsPatch(toZhTw.next, { locale: 'ko' }, false)
    expect(toKo.next.locale).toBe('ko')
    expect(toKo.localeChanged).toBe(true)

    const toZh = applySettingsPatch(toKo.next, { locale: 'zh-CN' }, false)
    expect(toZh.next.locale).toBe('zh-CN')
    expect(toZh.localeChanged).toBe(true)

    const invalid = applySettingsPatch(BASE, { locale: 'fr' as never }, false)
    expect(invalid.next.locale).toBe('zh-CN')
    expect(invalid.localeChanged).toBe(false)
  })
})
