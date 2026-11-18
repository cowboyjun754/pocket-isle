import { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL } from '../shared/aiProvider'
import { DEFAULT_LOCALE, getMessages } from '../shared/i18n'
import type {
  AiBreakdownResult,
  AiFileReadReceipt,
  AiJointSummaryResult,
  AiOrganizeResult,
  AppLocale,
  DecorationId,
  DecorationState,
  DockItem,
  FileSummary
} from '../shared/types'
import { validateAiEndpointUrl, type EffectiveAiConfig } from './aiSecrets'
import {
  extractDocTextOnly,
  IMAGE_EXTS,
  MAX_PDF_INPUT_BYTES,
  type ExtractedDoc
} from './fileExtractor'
import { asCleanText, sanitizeFileSummary } from './summaryGuard'

export {
  decodeTextBuffer,
  extractDocTextOnly,
  extractPdfText,
  extractPdfTextDetailed,
  extractXlsxPreview,
  IMAGE_EXTS,
  MAX_OFFICE_INPUT_BYTES,
  MAX_PDF_INPUT_BYTES,
  readTextFilePreview,
  readZipEntries,
  readZipEntryText,
  TEXT_EXTS,
  type ExtractedDoc
} from './fileExtractor'

export const MAX_VISION_IMAGES = 4
export const MAX_BATCH_INPUT_BYTES = 48 * 1024 * 1024

export interface ExtractSnippetOptions {
  encodeImage?: (filePath: string) => Promise<string | undefined>
  locale?: AppLocale
}

export interface ExtractBatchOptions {
  maxChars?: number
  concurrency?: number
  maxTotalInputBytes?: number
  maxVisionImages?: number
  enableVision?: boolean
  locale?: AppLocale
  encodeImage?: (filePath: string) => Promise<string | undefined>
  extractTextItem?: (
    item: DockItem,
    maxChars: number,
    signal?: AbortSignal,
    locale?: AppLocale
  ) => Promise<ExtractedDoc>
  signal?: AbortSignal
  onProgress?: (done: number, total: number, currentName: string) => void
}

/** Error subclass signaling that the user should configure or fix AI settings. */
export class AiSetupError extends Error {
  readonly needsSetup = true

  constructor(message: string) {
    super(message)
    this.name = 'AiSetupError'
  }
}

function makeAbortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

export async function extractFileSnippet(
  item: DockItem,
  maxChars = 2400,
  opts?: ExtractSnippetOptions
): Promise<ExtractedDoc> {
  const locale = opts?.locale ?? DEFAULT_LOCALE
  const m = getMessages(locale).ai
  if (!item.isDir && IMAGE_EXTS.has(item.ext)) {
    const base: ExtractedDoc = {
      id: item.id,
      name: item.name,
      ext: item.ext,
      size: item.size,
      snippet: '',
      readStatus: 'meta-only',
      attachedImage: false
    }
    if (!opts?.encodeImage) {
      base.readNote = m.visionDisabled
      return base
    }
    if (item.size > 15 * 1024 * 1024) {
      base.readNote = m.imageTooLarge
      return base
    }
    try {
      const dataUrl = await opts.encodeImage(item.path)
      if (dataUrl) {
        base.imageDataUrl = dataUrl
        base.attachedImage = true
        base.readStatus = 'partial'
        base.readNote = m.imageAttached
      } else {
        base.readNote = m.imageEncodeFailed
      }
    } catch {
      base.readNote = m.imageReadFailed
    }
    return base
  }
  return extractDocTextOnly(item, maxChars, locale)
}

/**
 * Extracts file snippets in batches with bounded concurrency, byte budget, abort propagation, and Vision image limit sync.
 */
export async function extractFilesBatch(
  items: DockItem[],
  opts?: ExtractBatchOptions
): Promise<ExtractedDoc[]> {
  const total = items.length
  if (total === 0) return []
  if (opts?.signal?.aborted) throw makeAbortError()

  const locale = opts?.locale ?? DEFAULT_LOCALE
  const m = getMessages(locale).ai
  const maxChars = opts?.maxChars ?? 2400
  const concurrency = Math.max(1, Math.min(4, opts?.concurrency ?? 2))
  const maxTotalInputBytes = opts?.maxTotalInputBytes ?? MAX_BATCH_INPUT_BYTES
  const maxVisionImages = opts?.maxVisionImages ?? MAX_VISION_IMAGES
  const textRunner =
    opts?.extractTextItem ??
    ((it: DockItem, mc: number, _sig?: AbortSignal, loc?: AppLocale) =>
      extractDocTextOnly(it, mc, loc ?? locale))

  const results: ExtractedDoc[] = new Array(total)
  let nextIdx = 0
  let doneCount = 0
  let consumedBytes = 0
  let reservedImages = 0

  const worker = async (): Promise<void> => {
    while (true) {
      if (opts?.signal?.aborted) throw makeAbortError()
      const idx = nextIdx++
      if (idx >= total) return

      const item = items[idx]
      opts?.onProgress?.(doneCount, total, item.name)

      if (!item.isDir && IMAGE_EXTS.has(item.ext)) {
        let doc: ExtractedDoc
        if (!opts?.enableVision || !opts?.encodeImage) {
          doc = {
            id: item.id,
            name: item.name,
            ext: item.ext,
            size: item.size,
            snippet: '',
            readStatus: 'meta-only',
            readNote: m.visionDisabled,
            attachedImage: false
          }
        } else if (reservedImages >= maxVisionImages) {
          doc = {
            id: item.id,
            name: item.name,
            ext: item.ext,
            size: item.size,
            snippet: '',
            readStatus: 'meta-only',
            readNote: m.imageQuotaExceeded(maxVisionImages),
            attachedImage: false
          }
        } else {
          reservedImages++
          doc = await extractFileSnippet(item, maxChars, { encodeImage: opts.encodeImage, locale })
          if (!doc.imageDataUrl) {
            reservedImages = Math.max(0, reservedImages - 1)
          }
        }
        results[idx] = doc
        doneCount++
        opts?.onProgress?.(doneCount, total, item.name)
        continue
      }

      const estimatedInput = item.isDir
        ? 0
        : Math.min(Math.max(0, item.size), item.ext === 'pdf' ? MAX_PDF_INPUT_BYTES : item.size)

      if (estimatedInput > 0 && consumedBytes + estimatedInput > maxTotalInputBytes) {
        results[idx] = {
          id: item.id,
          name: item.name,
          ext: item.ext,
          size: item.size,
          snippet: '',
          readStatus: 'meta-only',
          readNote: m.batchBudgetExceeded
        }
        doneCount++
        opts?.onProgress?.(doneCount, total, item.name)
        continue
      }

      consumedBytes += estimatedInput
      const doc = await textRunner(item, maxChars, opts?.signal, locale)
      if (opts?.signal?.aborted) throw makeAbortError()
      results[idx] = doc
      doneCount++
      opts?.onProgress?.(doneCount, total, item.name)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()))
  return results
}

/** Allocates model multimodal Vision image slots consistently with payload contents and UI read receipts. */
export function applyVisionImageBudget(
  docs: ExtractedDoc[],
  enableVision: boolean,
  maxImages = MAX_VISION_IMAGES,
  locale: AppLocale = DEFAULT_LOCALE
): ExtractedDoc[] {
  const m = getMessages(locale).ai
  let used = 0
  return docs.map((d) => {
    if (!d.imageDataUrl) {
      return { ...d, attachedImage: false }
    }
    if (!enableVision) {
      return {
        ...d,
        imageDataUrl: undefined,
        attachedImage: false,
        readStatus: 'meta-only',
        readNote: m.visionDisabled
      }
    }
    if (used >= maxImages) {
      return {
        ...d,
        imageDataUrl: undefined,
        attachedImage: false,
        readStatus: 'meta-only',
        readNote: m.imageQuotaExceeded(maxImages)
      }
    }
    used++
    return {
      ...d,
      attachedImage: true,
      readStatus: d.readStatus === 'meta-only' ? 'partial' : d.readStatus,
      readNote: d.readNote || m.imageAttached
    }
  })
}

export function requiresApiKey(baseUrl: string): boolean {
  const res = validateAiEndpointUrl(baseUrl || DEFAULT_AI_BASE_URL)
  return res.ok ? res.requiresKey : true
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  return (err as { name?: string }).name === 'AbortError'
}

type MultimodalPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'auto' } }

async function callChatJson<T>(
  cfg: EffectiveAiConfig,
  systemPrompt: string,
  userPrompt: string,
  opts?: {
    timeoutMs?: number
    signal?: AbortSignal
    images?: Array<{ id: string; name: string; dataUrl: string }>
    locale?: AppLocale
  }
): Promise<T> {
  const locale = opts?.locale ?? DEFAULT_LOCALE
  const m = getMessages(locale).ai
  const validated = validateAiEndpointUrl(cfg.baseUrl || DEFAULT_AI_BASE_URL, locale)
  if (!validated.ok) {
    throw new AiSetupError(validated.message)
  }
  const url = validated.endpoint
  if (validated.requiresKey && !cfg.apiKey.trim()) {
    throw new AiSetupError(m.missingKeySettings)
  }

  const ctrl = new AbortController()
  const onExternalAbort = (): void => ctrl.abort()
  if (opts?.signal?.aborted) {
    ctrl.abort()
  } else {
    opts?.signal?.addEventListener('abort', onExternalAbort, { once: true })
  }

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, opts?.timeoutMs ?? 32000)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (cfg.apiKey.trim()) {
    headers.Authorization = `Bearer ${cfg.apiKey.trim()}`
  }

  let userContent: string | MultimodalPart[] = userPrompt
  if (cfg.enableVision && opts?.images?.length) {
    const parts: MultimodalPart[] = [{ type: 'text', text: userPrompt }]
    for (const im of opts.images.slice(0, MAX_VISION_IMAGES)) {
      parts.push({ type: 'text', text: m.attachedImgTag(im.id, im.name) })
      parts.push({ type: 'image_url', image_url: { url: im.dataUrl, detail: 'low' } })
    }
    userContent = parts
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model.trim() || DEFAULT_AI_MODEL,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 120) || res.statusText}`)
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = typeof data.choices?.[0]?.message?.content === 'string'
      ? data.choices[0].message.content.trim()
      : ''
    if (!content) throw new Error(m.emptyResponse)
    return parseJsonLoose<T>(content, locale)
  } catch (err) {
    if (timedOut && !opts?.signal?.aborted) {
      throw new Error(m.timeout)
    }
    throw err
  } finally {
    clearTimeout(timer)
    opts?.signal?.removeEventListener('abort', onExternalAbort)
  }
}

export function parseJsonLoose<T>(raw: string, locale: AppLocale = DEFAULT_LOCALE): T {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(stripped) as T
  } catch {
    const first = stripped.indexOf('{')
    const last = stripped.lastIndexOf('}')
    if (first >= 0 && last > first) {
      return JSON.parse(stripped.slice(first, last + 1)) as T
    }
    throw new Error(getMessages(locale).ai.invalidJson)
  }
}

export async function testConnection(
  cfg: EffectiveAiConfig,
  locale: AppLocale = DEFAULT_LOCALE
): Promise<{ ok: boolean; message: string }> {
  const m = getMessages(locale).ai
  try {
    const res = await callChatJson<{ reply?: unknown }>(
      cfg,
      m.prompts.testSystem,
      m.prompts.testUser,
      { timeoutMs: 15000, locale }
    )
    const reply = asCleanText(res?.reply, m.prompts.replyMaxChars) || m.testReplyFallback
    return { ok: true, message: m.testSuccess(reply) }
  } catch (err) {
    return { ok: false, message: (err as Error).message || m.testFailed }
  }
}

export interface OrganizeModelResponse {
  otterBubble?: unknown
  items?: Array<{
    id?: unknown
    group?: unknown
    brief?: unknown
    bullets?: unknown
    attention?: unknown
  }>
}

export function mapOrganizeResponse(
  docs: ExtractedDoc[],
  data: OrganizeModelResponse,
  locale: AppLocale = DEFAULT_LOCALE
): {
  result: AiOrganizeResult
  updates: Map<string, { group: string; summary: FileSummary }>
} {
  const m = getMessages(locale).ai
  const updates = new Map<string, { group: string; summary: FileSummary }>()
  const docMap = new Map(docs.map((d) => [d.id, d]))
  const rawItems = data && typeof data === 'object' && Array.isArray(data.items) ? data.items : []

  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue
    const id = typeof it.id === 'string' ? it.id : ''
    const src = docMap.get(id)
    if (!src || updates.has(id)) continue
    const summary = sanitizeFileSummary(
      {
        brief: it.brief,
        bullets: it.bullets,
        attention: it.attention,
        readStatus: src.readStatus,
        readNote: src.readNote,
        updatedAt: Date.now()
      },
      locale
    )
    if (!summary) continue
    updates.set(id, {
      group: asCleanText(it.group, m.prompts.groupMaxChars) || m.defaultGroup,
      summary
    })
  }

  if (updates.size === 0) {
    return {
      result: {
        ok: false,
        message: m.organizeUnmatched
      },
      updates
    }
  }

  return {
    result: {
      ok: true,
      message: m.organizeSuccess(updates.size),
      otterBubble:
        asCleanText(data?.otterBubble, m.prompts.bubbleMaxChars) || m.organizeBubbleFallback
    },
    updates
  }
}

export async function organizeAndSummarize(
  cfg: EffectiveAiConfig,
  docs: ExtractedDoc[],
  signal?: AbortSignal,
  locale: AppLocale = DEFAULT_LOCALE
): Promise<{
  result: AiOrganizeResult
  updates: Map<string, { group: string; summary: FileSummary }>
}> {
  const m = getMessages(locale).ai
  if (docs.length === 0) {
    return {
      result: { ok: false, message: m.organizeEmpty },
      updates: new Map()
    }
  }

  const budgeted = applyVisionImageBudget(docs, !!cfg.enableVision, MAX_VISION_IMAGES, locale)

  const payload = budgeted.map((d) => ({
    id: d.id,
    name: d.name,
    ext: d.ext,
    sizeBytes: d.size,
    readStatus: d.readStatus,
    ...(d.readNote ? { readNote: d.readNote } : {}),
    hasAttachedImage: !!d.imageDataUrl,
    contentSnippet:
      d.snippet ||
      (d.imageDataUrl
        ? m.prompts.organizeImgFallback
        : d.readNote || m.prompts.organizeMetaFallback)
  }))

  const images = budgeted
    .filter((d): d is ExtractedDoc & { imageDataUrl: string } => !!d.imageDataUrl)
    .map((d) => ({ id: d.id, name: d.name, dataUrl: d.imageDataUrl }))

  const data = await callChatJson<OrganizeModelResponse>(
    cfg,
    m.prompts.organizeSystem,
    JSON.stringify(payload, null, 2),
    { signal, images, locale }
  )

  return mapOrganizeResponse(budgeted, data, locale)
}

export async function summarizeDocumentsTogether(
  cfg: EffectiveAiConfig,
  docs: ExtractedDoc[],
  focusPrompt?: string,
  signal?: AbortSignal,
  locale: AppLocale = DEFAULT_LOCALE
): Promise<AiJointSummaryResult> {
  const m = getMessages(locale).ai
  if (docs.length < 2) {
    return { ok: false, message: m.jointNeedTwo }
  }

  const budgeted = applyVisionImageBudget(docs, !!cfg.enableVision, MAX_VISION_IMAGES, locale)

  const context = {
    userFocus: focusPrompt?.trim() || m.prompts.jointDefaultFocus,
    files: budgeted.map((d) => ({
      id: d.id,
      name: d.name,
      ext: d.ext,
      readStatus: d.readStatus,
      ...(d.readNote ? { readNote: d.readNote } : {}),
      hasAttachedImage: !!d.imageDataUrl,
      snippet: d.snippet.slice(0, 1400)
    }))
  }

  const images = budgeted
    .filter((d): d is ExtractedDoc & { imageDataUrl: string } => !!d.imageDataUrl)
    .map((d) => ({ id: d.id, name: d.name, dataUrl: d.imageDataUrl }))

  const data = await callChatJson<{
    title?: unknown
    otterBubble?: unknown
    markdown?: unknown
  }>(
    cfg,
    m.prompts.jointSystem(budgeted.length),
    JSON.stringify(context, null, 2),
    { timeoutMs: 40000, signal, images, locale }
  )

  const md = typeof data?.markdown === 'string' ? data.markdown.trim() : ''
  if (!md) {
    return { ok: false, message: m.jointInvalid }
  }
  const receipts: AiFileReadReceipt[] = budgeted.map((d) => ({
    id: d.id,
    name: d.name,
    readStatus: d.readStatus,
    ...(d.readNote ? { readNote: d.readNote } : {}),
    ...(IMAGE_EXTS.has(d.ext) ? { imageAttached: !!d.imageDataUrl } : {})
  }))

  return {
    ok: true,
    message: m.jointSuccess(budgeted.length),
    title: asCleanText(data?.title, 60) || m.jointTitleFallback(budgeted.length),
    markdown: md,
    otterBubble: asCleanText(data?.otterBubble, m.prompts.bubbleMaxChars) || m.jointBubbleFallback,
    files: receipts
  }
}

export async function breakdownFocusGoal(
  cfg: EffectiveAiConfig,
  goal: string,
  docs: ExtractedDoc[],
  signal?: AbortSignal,
  durationMinutes = 25,
  locale: AppLocale = DEFAULT_LOCALE
): Promise<AiBreakdownResult> {
  const m = getMessages(locale).ai
  const mins = Math.min(Math.max(Math.round(durationMinutes || 25), 1), 180)

  const context = {
    userGoal: goal.trim() || m.prompts.breakdownDefaultGoal,
    relatedFiles: docs.map((d) => ({
      name: d.name,
      readStatus: d.readStatus,
      ...(d.readNote ? { readNote: d.readNote } : {}),
      snippet: d.snippet.slice(0, 500)
    }))
  }

  const data = await callChatJson<{
    refinedGoal?: unknown
    steps?: unknown
    otterBubble?: unknown
  }>(cfg, m.prompts.breakdownSystem(mins), JSON.stringify(context), { signal, locale })

  const steps = Array.isArray(data?.steps)
    ? data.steps.map((s) => asCleanText(s, 80)).filter(Boolean).slice(0, 4)
    : []

  return {
    ok: true,
    message: m.breakdownSuccess,
    refinedGoal: asCleanText(data?.refinedGoal, 80) || goal.trim(),
    steps,
    otterBubble:
      asCleanText(data?.otterBubble, m.prompts.bubbleMaxChars) || m.breakdownBubbleFallback
  }
}

export async function recommendDecoration(
  cfg: EffectiveAiConfig,
  moodPrompt: string,
  signal?: AbortSignal,
  locale: AppLocale = DEFAULT_LOCALE
): Promise<{
  state: DecorationState
  otterBubble: string
  reason: string
}> {
  const m = getMessages(locale).ai
  const data = await callChatJson<{
    ambience?: unknown
    enabled?: unknown
    otterBubble?: unknown
    reason?: unknown
  }>(cfg, m.prompts.decorSystem, moodPrompt.trim() || m.prompts.decorDefaultMood, {
    signal,
    locale
  })

  const validIds: DecorationId[] = ['flowers', 'bench', 'lamp', 'tree', 'cabin', 'windmill']
  const validSet = new Set<DecorationId>(validIds)
  const rawList = Array.isArray(data?.enabled)
    ? data.enabled.filter((id): id is DecorationId => typeof id === 'string' && validSet.has(id as DecorationId))
    : (['flowers', 'bench', 'tree'] as DecorationId[])
  const set = new Set(rawList)
  const enabled = Object.fromEntries(validIds.map((k) => [k, set.has(k)])) as Record<
    DecorationId,
    boolean
  >
  const ambience =
    data?.ambience === 'night' || data?.ambience === 'rain' ? data.ambience : 'day'
  return {
    state: {
      ambience,
      enabled
    },
    otterBubble: asCleanText(data?.otterBubble, m.prompts.bubbleMaxChars) || m.decorBubbleFallback,
    reason: asCleanText(data?.reason, 80) || m.decorReasonFallback
  }
}
