import type { AppLocale } from './types'

export const DEFAULT_AI_BASE_URL = 'https://api.deepseek.com/v1'
export const DEFAULT_AI_MODEL = 'deepseek-chat'

export function getAiPresets(
  locale: AppLocale = 'zh-CN'
): Array<{ label: string; baseUrl: string; model: string }> {
  const isEn = locale === 'en'
  return [
    { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    {
      label: isEn ? 'Qwen (DashScope)' : '通义千问',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus'
    },
    { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    {
      label: isEn ? 'Ollama (Local)' : 'Ollama (本地)',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b'
    },
    {
      label: isEn ? 'LM Studio (Local)' : 'LM Studio (本地)',
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
  const isEn = locale === 'en'
  const clean = (baseUrl || DEFAULT_AI_BASE_URL).trim()
  if (!clean) return 'DeepSeek'
  try {
    const u = new URL(normalizeInputAiUrl(clean))
    const host = u.hostname.toLowerCase()
    if (host.includes('deepseek.com')) return 'DeepSeek'
    if (host.includes('dashscope.aliyuncs.com')) return isEn ? 'Qwen' : '通义千问'
    if (host.includes('openai.com')) return 'OpenAI'
    if (isLoopbackHost(host) && (u.port === '11434' || clean.includes('11434'))) {
      return isEn ? 'Ollama (Local)' : 'Ollama (本地)'
    }
    if (isLoopbackHost(host) && (u.port === '1234' || clean.includes('1234'))) {
      return isEn ? 'LM Studio (Local)' : 'LM Studio (本地)'
    }
    if (isLoopbackHost(host)) return isEn ? `Local (${u.host})` : `本地 (${u.host})`
    return u.host
  } catch {
    return isEn ? 'Custom Model' : '自定义模型'
  }
}
