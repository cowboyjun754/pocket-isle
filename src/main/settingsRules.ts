import type { Settings, SettingsPatch } from '../shared/types'

export const COPY_LIMIT_MIN_MB = 64
export const COPY_LIMIT_MAX_MB = 20480

/** 校验并应用通用设置更新：限制副本容量上限区间，未打包时不修改开机自启状态 */
export function applySettingsPatch(
  current: Settings,
  rawPatch: unknown,
  isPackaged: boolean
): {
  next: Settings
  alwaysOnTopChanged: boolean
  openAtLoginChanged: boolean
} {
  const patch: SettingsPatch =
    rawPatch && typeof rawPatch === 'object' ? (rawPatch as SettingsPatch) : {}

  const next: Settings = {
    ...current,
    ai: { ...current.ai }
  }
  let alwaysOnTopChanged = false
  let openAtLoginChanged = false

  if (typeof patch.alwaysOnTop === 'boolean' && patch.alwaysOnTop !== current.alwaysOnTop) {
    next.alwaysOnTop = patch.alwaysOnTop
    alwaysOnTopChanged = true
  }

  if (
    isPackaged &&
    typeof patch.openAtLogin === 'boolean' &&
    patch.openAtLogin !== current.openAtLogin
  ) {
    next.openAtLogin = patch.openAtLogin
    openAtLoginChanged = true
  }

  if (typeof patch.copyLimitMB === 'number' && Number.isFinite(patch.copyLimitMB)) {
    next.copyLimitMB = Math.round(
      Math.min(Math.max(patch.copyLimitMB, COPY_LIMIT_MIN_MB), COPY_LIMIT_MAX_MB)
    )
  }

  return { next, alwaysOnTopChanged, openAtLoginChanged }
}
