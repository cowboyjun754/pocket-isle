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
  it('migrates legacy plaintext apiKey into encrypted aiSecrets and scrubs data.json', () => {
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

    // Decrypted under DeepSeek origin while public config never leaks plaintext apiKey
    expect(secrets.getKey('https://api.deepseek.com/v1')).toBe('sk-legacy-secret-123')
    const pub = secrets.toPublicAiConfig(store.data.settings.ai)
    expect(pub.hasApiKey).toBe(true)
    expect('apiKey' in pub).toBe(false)

    // Persisted file must contain cipher only, no plaintext key
    const diskText = readFileSync(join(dir, 'data.json'), 'utf8')
    expect(diskText).not.toContain('sk-legacy-secret-123')
    expect(diskText).toContain('enc:')
  })

  it('isolates credentials by protocol/host/port and never reuses keys across providers', async () => {
    const dir = makeTempDir('pocket-isle-iso-')
    const store = new Store(dir)
    const secrets = new AiCredentialStore(store, mockCodec)

    secrets.setKey('https://api.deepseek.com/v1', 'sk-deepseek-key')

    // Switching to OpenAI without entering a key must reject reusing DeepSeek key
    const toOpenAi = secrets.resolveForInput({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    })
    expect(toOpenAi.ok).toBe(false)

    // Switching to local Ollama succeeds with an empty apiKey
    const toOllama = secrets.resolveForInput({
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b'
    })
    expect(toOllama.ok).toBe(true)
    if (toOllama.ok) {
      expect(toOllama.cfg.apiKey).toBe('')
    }

    // Outbound test request to Ollama must not attach DeepSeek Authorization header
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

    // Previously stored DeepSeek key remains intact
    expect(secrets.getKey('https://api.deepseek.com/v1')).toBe('sk-deepseek-key')
  })

  it('enforces HTTPS for remote endpoints while allowing HTTP on loopback hosts', () => {
    expect(validateAiEndpointUrl('http://api.openai.com/v1').ok).toBe(false)
    expect(validateAiEndpointUrl('https://api.openai.com/v1').ok).toBe(true)
    expect(validateAiEndpointUrl('http://localhost:11434/v1').ok).toBe(true)
    expect(validateAiEndpointUrl('http://127.0.0.1:1234/v1').ok).toBe(true)
  })
})
