import type { Settings, SettingsPatch } from '../shared/types'

export const COPY_LIMIT_MIN_MB = 64
export const COPY_LIMIT_MAX_MB = 20480
export const FOCUS_MIN_MINUTES = 1
export const FOCUS_MAX_MINUTES = 180
export const REST_MIN_MINUTES = 1
export const REST_MAX_MINUTES = 60

/** Validates and applies general settings updates (clamps quota & skips openAtLogin when unpackaged). */
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

  if (typeof patch.focusMinutes === 'number' && Number.isFinite(patch.focusMinutes)) {
    next.focusMinutes = Math.round(
      Math.min(Math.max(patch.focusMinutes, FOCUS_MIN_MINUTES), FOCUS_MAX_MINUTES)
    )
  }

  if (typeof patch.restMinutes === 'number' && Number.isFinite(patch.restMinutes)) {
    next.restMinutes = Math.round(
      Math.min(Math.max(patch.restMinutes, REST_MIN_MINUTES), REST_MAX_MINUTES)
    )
  }

  if (typeof patch.focusNotify === 'boolean') {
    next.focusNotify = patch.focusNotify
  }

  return { next, alwaysOnTopChanged, openAtLoginChanged }
}
