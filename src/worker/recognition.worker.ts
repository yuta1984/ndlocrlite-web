/**
 * 認識専用 Web Worker
 * rec30 / rec50 / rec100 の3モデルを保持し、メインスレッドから指定されたモデルで認識する
 */

import './ort-wasm'
import { RecognizerSet } from './recognizer-set'
import type { RecWorkerInMessage, RecWorkerOutMessage } from '../types/recognition-worker'

let recognizers: RecognizerSet | null = null

const post = (msg: RecWorkerOutMessage) => self.postMessage(msg)

self.onmessage = async (e: MessageEvent<RecWorkerInMessage>) => {
  const msg = e.data

  if (msg.type === 'REC_INIT') {
    try {
      recognizers = new RecognizerSet(msg.singleModel ?? false)
      await recognizers.load((model, progress) => post({ type: 'REC_PROGRESS', model, progress }))
      post({ type: 'REC_READY' })
    } catch (err) {
      post({ type: 'REC_ERROR', error: (err as Error).message })
    }
  } else if (msg.type === 'REC_PROCESS') {
    try {
      const results: Array<{ id: number; text: string }> = []
      for (const job of msg.jobs) {
        const text = await recognizers!.recognize(job.model, job.image)
        results.push({ id: job.id, text })
      }
      post({ type: 'REC_COMPLETE', batchId: msg.batchId, results })
    } catch (err) {
      post({ type: 'REC_ERROR', batchId: msg.batchId, error: (err as Error).message })
    }
  } else if (msg.type === 'REC_TERMINATE') {
    recognizers?.dispose()
    self.close()
  }
}
