import type { Worker } from 'node:worker_threads'
import { DEFAULT_LOCALE, getMessages } from '../shared/i18n'
import type { AppLocale, DockItem } from '../shared/types'
import type { WorkerExtractRequest, WorkerExtractResponse } from './extractWorker'
import createExtractWorker from './extractWorker?nodeWorker'
import type { ExtractedDoc } from './fileExtractor'

interface PendingReq {
  resolve: (doc: ExtractedDoc) => void
  reject: (err: Error) => void
  locale: AppLocale
}

let worker: Worker | null = null
let nextReqId = 1
const pending = new Map<number, PendingReq>()

function makeAbortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

function resetWorkerWithError(err: Error): void {
  const cur = worker
  worker = null
  if (cur) {
    void cur.terminate().catch(() => undefined)
  }
  for (const [, p] of pending) {
    p.reject(err)
  }
  pending.clear()
}

function ensureWorker(): Worker {
  if (worker) return worker
  const w = createExtractWorker({})
  w.on('message', (msg: WorkerExtractResponse) => {
    const entry = pending.get(msg.reqId)
    if (!entry) return
    pending.delete(msg.reqId)
    if (msg.doc) {
      entry.resolve(msg.doc)
    } else {
      entry.reject(new Error(msg.error || getMessages(entry.locale).main.workerExtractFailed))
    }
  })
  w.on('error', (err) => {
    resetWorkerWithError(err instanceof Error ? err : new Error(String(err)))
  })
  w.on('exit', (code) => {
    if (worker === w) {
      const firstLocale = pending.values().next().value?.locale ?? DEFAULT_LOCALE
      resetWorkerWithError(new Error(getMessages(firstLocale).main.workerExitError(code)))
    }
  })
  worker = w
  return w
}

/**
 * Runs file reading and Office/PDF decompression on a background worker thread so UI dragging and timers never stall.
 * Terminates the worker immediately on AbortSignal cancellation.
 */
export function extractTextInWorker(
  item: DockItem,
  maxChars: number,
  signal?: AbortSignal,
  locale: AppLocale = DEFAULT_LOCALE
): Promise<ExtractedDoc> {
  if (signal?.aborted) {
    return Promise.reject(makeAbortError())
  }
  return new Promise((resolve, reject) => {
    const w = ensureWorker()
    const reqId = nextReqId++

    const cleanupSignal = (): void => {
      signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = (): void => {
      cleanupSignal()
      pending.delete(reqId)
      resetWorkerWithError(makeAbortError())
      reject(makeAbortError())
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    pending.set(reqId, {
      locale,
      resolve: (doc) => {
        cleanupSignal()
        resolve(doc)
      },
      reject: (err) => {
        cleanupSignal()
        reject(err)
      }
    })

    const req: WorkerExtractRequest = { reqId, item, maxChars, locale }
    w.postMessage(req)
  })
}

export function disposeExtractWorker(): void {
  resetWorkerWithError(makeAbortError())
}
