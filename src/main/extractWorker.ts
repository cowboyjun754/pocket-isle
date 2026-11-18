import { parentPort } from 'node:worker_threads'
import type { DockItem } from '../shared/types'
import { extractDocTextOnly, type ExtractedDoc } from './fileExtractor'

export interface WorkerExtractRequest {
  reqId: number
  item: DockItem
  maxChars: number
}

export interface WorkerExtractResponse {
  reqId: number
  doc?: ExtractedDoc
  error?: string
}

if (parentPort) {
  parentPort.on('message', async (msg: WorkerExtractRequest) => {
    try {
      const doc = await extractDocTextOnly(msg.item, msg.maxChars)
      const res: WorkerExtractResponse = { reqId: msg.reqId, doc }
      parentPort?.postMessage(res)
    } catch (err) {
      const res: WorkerExtractResponse = {
        reqId: msg.reqId,
        error: (err as Error)?.message || 'worker extraction failed'
      }
      parentPort?.postMessage(res)
    }
  })
}
