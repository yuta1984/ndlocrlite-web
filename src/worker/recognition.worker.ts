/**
 * 認識専用 Web Worker
 * rec30 / rec50 / rec100 の3モデルを保持し、charCountCategory に応じて使い分ける
 */

import './onnx-config'
import { loadModel } from './model-loader'
import { TextRecognizer } from './text-recognizer'
import type { RecWorkerInMessage, RecWorkerOutMessage } from '../types/recognition-worker'

let rec30: TextRecognizer | null = null
let rec50: TextRecognizer | null = null
let rec100: TextRecognizer | null = null

function selectRecognizer(charCountCategory?: number): TextRecognizer {
  if (charCountCategory === 3) return rec30!
  if (charCountCategory === 2) return rec50!
  return rec100!
}

self.onmessage = async (e: MessageEvent<RecWorkerInMessage>) => {
  const msg = e.data

  if (msg.type === 'REC_INIT') {
    try {
      const progresses = [0, 0, 0]
      const reportProgress = () => {
        const avg = (progresses[0] + progresses[1] + progresses[2]) / 3
        self.postMessage({ type: 'REC_PROGRESS', progress: avg } satisfies RecWorkerOutMessage)
      }

      const [d30, d50, d100] = await Promise.all([
        loadModel('recognition30',  (p) => { progresses[0] = p; reportProgress() }),
        loadModel('recognition50',  (p) => { progresses[1] = p; reportProgress() }),
        loadModel('recognition100', (p) => { progresses[2] = p; reportProgress() }),
      ])

      rec30  = new TextRecognizer([1, 3, 16, 256]); await rec30.initialize(d30)
      rec50  = new TextRecognizer([1, 3, 16, 384]); await rec50.initialize(d50)
      rec100 = new TextRecognizer([1, 3, 16, 768]); await rec100.initialize(d100)

      self.postMessage({ type: 'REC_READY' } satisfies RecWorkerOutMessage)
    } catch (err) {
      self.postMessage({ type: 'REC_ERROR', error: (err as Error).message } satisfies RecWorkerOutMessage)
    }
  } else if (msg.type === 'REC_PROCESS') {
    try {
      const results: Array<{ id: number; text: string; confidence: number }> = []
      for (const job of msg.jobs) {
        const r = await selectRecognizer(job.charCountCategory).recognizeCropped(job.croppedImageData)
        results.push({ id: job.id, text: r.text, confidence: r.confidence })
      }
      self.postMessage({ type: 'REC_COMPLETE', results } satisfies RecWorkerOutMessage)
    } catch (err) {
      self.postMessage({ type: 'REC_ERROR', error: (err as Error).message } satisfies RecWorkerOutMessage)
    }
  } else if (msg.type === 'REC_TERMINATE') {
    rec30?.dispose()
    rec50?.dispose()
    rec100?.dispose()
    self.close()
  }
}
