import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  isLoopbackHost,
  normalizeInputAiUrl
} from '../shared/aiProvider'
import type { AiConfig, AiConfigInput, AiKeyStatus } from '../shared/types'
import type { Store } from './store'

export interface EffectiveAiConfig {
  baseUrl: string
  apiKey: string
  model: string
  enableVision?: boolean
}

export interface SecretCodec {
  isEncryptionAvailable(): boolean
  encrypt(plain: string): string
  decrypt(cipher: string): string
}

export type EndpointValidation =
  | {
      ok: true
      endpoint: string
      origin: string
      isLocal: boolean
      requiresKey: boolean
    }
  | {
      ok: false
      message: string
    }

export function validateAiEndpointUrl(rawBaseUrl: string): EndpointValidation {
  const normalized = normalizeInputAiUrl(rawBaseUrl || DEFAULT_AI_BASE_URL)
  let u: URL
  try {
    u = new URL(normalized)
  } catch {
    return { ok: false, message: '接口地址格式无效，请检查 Base URL' }
  }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, message: '接口地址仅支持 HTTPS 或本地 HTTP 协议' }
  }

  const isLocal = isLoopbackHost(u.hostname)
  if (u.protocol === 'http:' && !isLocal) {
    return {
      ok: false,
      message: '远程接口请使用 HTTPS 加密连接（仅 localhost / 127.0.0.1 本地模型允许 HTTP）'
    }
  }

  const clean = normalized.replace(/\/+$/, '')
  const endpoint = clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`
  return {
    ok: true,
    endpoint,
    origin: u.origin.toLowerCase(),
    isLocal,
    requiresKey: !isLocal
  }
}

export function normalizeAiOrigin(rawBaseUrl: string): string | null {
  const res = validateAiEndpointUrl(rawBaseUrl)
  return res.ok ? res.origin : null
}

/**
 * 按协议 + 主机 + 端口分源管理 AI 凭据：
 * - 使用 Electron safeStorage 加密后存入 store.data.aiSecrets（绝不写入明文）；
 * - 切换服务商或本地模型时天然隔离，不会将 A 端点的密钥发给 B 端点。
 */
export class AiCredentialStore {
  private memoryOnly = new Map<string, string>()

  constructor(
    private store: Store,
    private codec: SecretCodec
  ) {}

  migrateLegacyKey(): boolean {
    const legacy = this.store.consumeLegacyAiKey()
    if (!legacy || !legacy.apiKey.trim()) return false
    const origin = normalizeAiOrigin(legacy.baseUrl)
    if (!origin) return false
    this.setKey(legacy.baseUrl, legacy.apiKey)
    this.store.saveNow()
    return true
  }

  hasKey(baseUrl: string): boolean {
    return this.getKey(baseUrl).length > 0
  }

  getKey(baseUrl: string): string {
    const origin = normalizeAiOrigin(baseUrl)
    if (!origin) return ''
    const mem = this.memoryOnly.get(origin)
    if (mem) return mem
    const cipher = this.store.data.aiSecrets?.[origin]
    if (!cipher || !this.codec.isEncryptionAvailable()) return ''
    try {
      return this.codec.decrypt(cipher).trim()
    } catch {
      return ''
    }
  }

  setKey(baseUrl: string, apiKey: string): { origin: string | null; persisted: boolean } {
    const origin = normalizeAiOrigin(baseUrl)
    if (!origin) return { origin: null, persisted: false }
    const clean = apiKey.trim()
    if (!clean) {
      this.clearKey(baseUrl)
      return { origin, persisted: true }
    }
    if (this.codec.isEncryptionAvailable()) {
      const cipher = this.codec.encrypt(clean)
      this.memoryOnly.delete(origin)
      this.store.update((d) => {
        d.aiSecrets = { ...(d.aiSecrets ?? {}), [origin]: cipher }
      })
      return { origin, persisted: true }
    }
    // 系统加密不可用时仅保存在当前进程内存，不将明文写入磁盘
    this.memoryOnly.set(origin, clean)
    return { origin, persisted: false }
  }

  clearKey(baseUrl: string): void {
    const origin = normalizeAiOrigin(baseUrl)
    if (!origin) return
    this.memoryOnly.delete(origin)
    if (this.store.data.aiSecrets && origin in this.store.data.aiSecrets) {
      this.store.update((d) => {
        if (!d.aiSecrets) return
        const next = { ...d.aiSecrets }
        delete next[origin]
        d.aiSecrets = next
      })
    }
  }

  getKeyStatus(baseUrl: string): AiKeyStatus {
    const v = validateAiEndpointUrl(baseUrl)
    if (!v.ok) {
      return {
        origin: '',
        hasApiKey: false,
        requiresKey: true,
        valid: false,
        message: v.message
      }
    }
    return {
      origin: v.origin,
      hasApiKey: this.hasKey(baseUrl),
      requiresKey: v.requiresKey,
      valid: true
    }
  }

  toPublicAiConfig(ai: AiConfig): AiConfig {
    const status = this.getKeyStatus(ai.baseUrl || DEFAULT_AI_BASE_URL)
    return {
      baseUrl: ai.baseUrl || DEFAULT_AI_BASE_URL,
      model: ai.model || DEFAULT_AI_MODEL,
      enableVision: !!ai.enableVision,
      hasApiKey: status.hasApiKey,
      requiresKey: status.requiresKey
    }
  }

  resolveForSavedSettings(): { ok: true; cfg: EffectiveAiConfig } | { ok: false; message: string } {
    const ai = this.store.data.settings.ai
    return this.resolveForInput({
      baseUrl: ai.baseUrl,
      model: ai.model,
      enableVision: ai.enableVision
    })
  }

  resolveForInput(
    input: AiConfigInput
  ): { ok: true; cfg: EffectiveAiConfig; origin: string } | { ok: false; message: string } {
    const rawBase = String(input.baseUrl ?? '').trim() || DEFAULT_AI_BASE_URL
    const v = validateAiEndpointUrl(rawBase)
    if (!v.ok) return v

    const explicit = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
    const resolvedKey = input.clearApiKey ? '' : explicit || this.getKey(rawBase)

    if (v.requiresKey && !resolvedKey) {
      return {
        ok: false,
        message: '请先填写当前服务商的 API Key（本地模型如 Ollama 可留空）'
      }
    }

    return {
      ok: true,
      origin: v.origin,
      cfg: {
        baseUrl: rawBase,
        apiKey: resolvedKey,
        model: String(input.model ?? '').trim() || DEFAULT_AI_MODEL,
        enableVision: !!input.enableVision
      }
    }
  }
}
