import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiCredentialStore, validateAiEndpointUrl, type SecretCodec } from './aiSecrets'
import { testConnection } from './aiService'
import { Store } from './store'

const dirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

const mockCodec: SecretCodec = {
  isEncryptionAvailable: () => true,
  encrypt: (plain: string) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (cipher: string) => {
    if (!cipher.startsWith('enc:')) throw new Error('bad cipher')
    return Buffer.from(cipher.slice(4), 'base64').toString('utf8')
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

describe('AiCredentialStore & validateAiEndpointUrl', () => {
  it('迁移旧版明文 apiKey 到加密 aiSecrets 并从 data.json 中清除明文', () => {
    const dir = makeTempDir('pocket-isle-secrets-')
    writeFileSync(
      join(dir, 'data.json'),
      JSON.stringify({
        version: 2,
        items: [],
        settings: {
          alwaysOnTop: true,
          openAtLogin: false,
          copyLimitMB: 2048,
          ai: {
            baseUrl: 'https://api.deepseek.com/v1',
            apiKey: 'sk-legacy-secret-123',
            model: 'deepseek-chat'
          }
        }
      }),
      'utf8'
    )

    const store = new Store(dir)
    const secrets = new AiCredentialStore(store, mockCodec)
    expect(secrets.migrateLegacyKey()).toBe(true)

    // 密钥已可按 DeepSeek 源解密读取，且公开配置不含明文 apiKey
    expect(secrets.getKey('https://api.deepseek.com/v1')).toBe('sk-legacy-secret-123')
    const pub = secrets.toPublicAiConfig(store.data.settings.ai)
    expect(pub.hasApiKey).toBe(true)
    expect('apiKey' in pub).toBe(false)

    // 落盘文件内容中绝无明文密钥
    const diskText = readFileSync(join(dir, 'data.json'), 'utf8')
    expect(diskText).not.toContain('sk-legacy-secret-123')
    expect(diskText).toContain('enc:')
  })

  it('按协议、主机、端口隔离凭据，切换服务商与本地模型绝不沿用旧密钥', async () => {
    const dir = makeTempDir('pocket-isle-iso-')
    const store = new Store(dir)
    const secrets = new AiCredentialStore(store, mockCodec)

    secrets.setKey('https://api.deepseek.com/v1', 'sk-deepseek-key')

    // 切换到 OpenAI 且未输入新密钥 -> 应拒绝沿用 DeepSeek 的密钥
    const toOpenAi = secrets.resolveForInput({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    })
    expect(toOpenAi.ok).toBe(false)

    // 切换到本地 Ollama -> 无需密钥即可通过解析，且 apiKey 为空
    const toOllama = secrets.resolveForInput({
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b'
    })
    expect(toOllama.ok).toBe(true)
    if (toOllama.ok) {
      expect(toOllama.cfg.apiKey).toBe('')
    }

    // 模拟真实测试请求：发往 Ollama 时请求头不得携带 DeepSeek Authorization
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"reply":"你好"}' } }] })
    }))
    vi.stubGlobal('fetch', fetchSpy)

    if (toOllama.ok) {
      const res = await testConnection(toOllama.cfg)
      expect(res.ok).toBe(true)
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('http://localhost:11434/v1/chat/completions')
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
    }

    // 原先保存的 DeepSeek 密钥仍完整保留
    expect(secrets.getKey('https://api.deepseek.com/v1')).toBe('sk-deepseek-key')
  })

  it('远程接口强制 HTTPS，本地环回地址允许 HTTP', () => {
    expect(validateAiEndpointUrl('http://api.openai.com/v1').ok).toBe(false)
    expect(validateAiEndpointUrl('https://api.openai.com/v1').ok).toBe(true)
    expect(validateAiEndpointUrl('http://localhost:11434/v1').ok).toBe(true)
    expect(validateAiEndpointUrl('http://127.0.0.1:1234/v1').ok).toBe(true)
  })
})
