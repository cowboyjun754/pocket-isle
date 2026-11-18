import type { AppLocale } from './types'
import { EN } from './locales/en'
import { ES } from './locales/es'
import { JA } from './locales/ja'
import { KO } from './locales/ko'
import { ZH_CN, type AppMessages } from './locales/zhCN'
import { ZH_TW } from './locales/zhTW'

export type { AppMessages }

export const DEFAULT_LOCALE: AppLocale = 'zh-CN'

export const SUPPORTED_LOCALES: Array<{ id: AppLocale; label: string }> = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'es', label: 'Español' }
]

const MESSAGES: Record<AppLocale, AppMessages> = {
  'zh-CN': ZH_CN,
  'zh-TW': ZH_TW,
  en: EN,
  ja: JA,
  ko: KO,
  es: ES
}

/** Type guard checking whether a candidate value matches a supported AppLocale. */
export function isSupportedLocale(raw: unknown): raw is AppLocale {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, raw)
}

/** Normalizes any candidate setting value to a supported AppLocale. */
export function resolveLocale(raw: unknown): AppLocale {
  return isSupportedLocale(raw) ? raw : DEFAULT_LOCALE
}

export function getMessages(locale?: AppLocale): AppMessages {
  return MESSAGES[resolveLocale(locale)]
}
