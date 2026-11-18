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
  it('将 copyLimitMB 限制在合法区间并四舍五入', () => {
    expect(applySettingsPatch(BASE, { copyLimitMB: 10 }, false).next.copyLimitMB).toBe(
      COPY_LIMIT_MIN_MB
    )
    expect(applySettingsPatch(BASE, { copyLimitMB: 99999 }, false).next.copyLimitMB).toBe(
      COPY_LIMIT_MAX_MB
    )
    expect(applySettingsPatch(BASE, { copyLimitMB: 512.6 }, false).next.copyLimitMB).toBe(513)
    expect(applySettingsPatch(BASE, { copyLimitMB: Number.NaN }, false).next.copyLimitMB).toBe(2048)
  })

  it('未打包状态下忽略 openAtLogin 修改，打包后允许修改', () => {
    const dev = applySettingsPatch(BASE, { openAtLogin: true }, false)
    expect(dev.next.openAtLogin).toBe(false)
    expect(dev.openAtLoginChanged).toBe(false)

    const prod = applySettingsPatch(BASE, { openAtLogin: true }, true)
    expect(prod.next.openAtLogin).toBe(true)
    expect(prod.openAtLoginChanged).toBe(true)
  })

  it('正确记录 alwaysOnTop 变更标记', () => {
    const off = applySettingsPatch(BASE, { alwaysOnTop: false }, false)
    expect(off.next.alwaysOnTop).toBe(false)
    expect(off.alwaysOnTopChanged).toBe(true)

    const same = applySettingsPatch(BASE, { alwaysOnTop: true }, false)
    expect(same.alwaysOnTopChanged).toBe(false)
  })

  it('校验并限制 focusMinutes、restMinutes 与 focusNotify', () => {
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
})
