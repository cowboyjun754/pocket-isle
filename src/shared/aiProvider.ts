import type { AppLocale } from './types'

export const DEFAULT_AI_BASE_URL = 'https://api.deepseek.com/v1'
export const DEFAULT_AI_MODEL = 'deepseek-chat'

interface ProviderLabels {
  qwenPreset: string
  qwenProvider: string
  ollama: string
  lmStudio: string
  localHost: (host: string) => string
  customModel: string
}

const PROVIDER_LABELS: Record<AppLocale, ProviderLabels> = {
  'zh-CN': {
    qwenPreset: '通义千问',
    qwenProvider: '通义千问',
    ollama: 'Ollama (本地)',
    lmStudio: 'LM Studio (本地)',
    localHost: (host) => `本地 (${host})`,
    customModel: '自定义模型'
  },
  'zh-TW': {
    qwenPreset: '通義千問',
    qwenProvider: '通義千問',
    ollama: 'Ollama (本機)',
    lmStudio: 'LM Studio (本機)',
    localHost: (host) => `本機 (${host})`,
    customModel: '自訂模型'
  },
  en: {
    qwenPreset: 'Qwen (DashScope)',
    qwenProvider: 'Qwen',
    ollama: 'Ollama (Local)',
    lmStudio: 'LM Studio (Local)',
    localHost: (host) => `Local (${host})`,
    customModel: 'Custom Model'
  },
  ja: {
    qwenPreset: 'Qwen (DashScope)',
    qwenProvider: 'Qwen',
    ollama: 'Ollama (ローカル)',
    lmStudio: 'LM Studio (ローカル)',
    localHost: (host) => `ローカル (${host})`,
    customModel: 'カスタムモデル'
  },
  ko: {
    qwenPreset: 'Qwen (DashScope)',
    qwenProvider: 'Qwen',
    ollama: 'Ollama (로컬)',
    lmStudio: 'LM Studio (로컬)',
    localHost: (host) => `로컬 (${host})`,
    customModel: '사용자 지정 모델'
  },
  es: {
    qwenPreset: 'Qwen (DashScope)',
    qwenProvider: 'Qwen',
    ollama: 'Ollama (Local)',
    lmStudio: 'LM Studio (Local)',
    localHost: (host) => `Local (${host})`,
    customModel: 'Modelo personalizado'
  }
}

export function getAiPresets(
  locale: AppLocale = 'zh-CN'
): Array<{ label: string; baseUrl: string; model: string }> {
  const labels = PROVIDER_LABELS[locale] ?? PROVIDER_LABELS['zh-CN']
  return [
    { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    {
      label: labels.qwenPreset,
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus'
    },
    { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    {
      label: labels.ollama,
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b'
    },
    {
      label: labels.lmStudio,
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'local-model'
    }
  ]
}

export const AI_PRESETS = getAiPresets('zh-CN')

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
}

export function normalizeInputAiUrl(rawBaseUrl: string): string {
  let clean = rawBaseUrl.trim().replace(/\/+$/, '')
  if (!clean) clean = DEFAULT_AI_BASE_URL
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(clean)) {
    const hostPart = clean.split(/[/?#]/)[0]
    const hostOnly = hostPart.replace(/:\d+$/, '')
    clean = `${isLoopbackHost(hostOnly) ? 'http' : 'https'}://${clean}`
  }
  return clean
}

export function describeAiProvider(baseUrl: string, locale: AppLocale = 'zh-CN'): string {
  const labels = PROVIDER_LABELS[locale] ?? PROVIDER_LABELS['zh-CN']
  const clean = (baseUrl || DEFAULT_AI_BASE_URL).trim()
  if (!clean) return 'DeepSeek'
  try {
    const u = new URL(normalizeInputAiUrl(clean))
    const host = u.hostname.toLowerCase()
    if (host.includes('deepseek.com')) return 'DeepSeek'
    if (host.includes('dashscope.aliyuncs.com')) return labels.qwenProvider
    if (host.includes('openai.com')) return 'OpenAI'
    if (isLoopbackHost(host) && (u.port === '11434' || clean.includes('11434'))) {
      return labels.ollama
    }
    if (isLoopbackHost(host) && (u.port === '1234' || clean.includes('1234'))) {
      return labels.lmStudio
    }
    if (isLoopbackHost(host)) return labels.localHost(u.host)
    return u.host
  } catch {
    return labels.customModel
  }
}
