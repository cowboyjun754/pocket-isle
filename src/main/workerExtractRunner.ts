import type { Worker } from 'node:worker_threads'
import type { DockItem } from '../shared/types'
import type { WorkerExtractRequest, WorkerExtractResponse } from './extractWorker'
import createExtractWorker from './extractWorker?nodeWorker'
import type { ExtractedDoc } from './fileExtractor'

interface PendingReq {
  resolve: (doc: ExtractedDoc) => void
  reject: (err: Error) => void
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
      entry.reject(new Error(msg.error || '文件提取失败'))
    }
  })
  w.on('error', (err) => {
    resetWorkerWithError(err instanceof Error ? err : new Error(String(err)))
  })
  w.on('exit', (code) => {
    if (worker === w) {
      resetWorkerWithError(new Error(`提取工作线程异常退出 (${code})`))
    }
  })
  worker = w
  return w
}

/**
 * 在独立 Worker 线程执行文件读取与 Office/PDF 同步解压，避免卡顿小岛拖动与计时器；
 * 收到取消信号时立即终止工作线程并中断后续队列。
 */
export function extractTextInWorker(
  item: DockItem,
  maxChars: number,
  signal?: AbortSignal
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
      resolve: (doc) => {
        cleanupSignal()
        resolve(doc)
      },
      reject: (err) => {
        cleanupSignal()
        reject(err)
      }
    })

    const req: WorkerExtractRequest = { reqId, item, maxChars }
    w.postMessage(req)
  })
}

export function disposeExtractWorker(): void {
  resetWorkerWithError(makeAbortError())
}
