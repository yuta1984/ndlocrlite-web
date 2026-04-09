/**
 * 認識専用 Web Worker
 * PaddleOCR PP-OCRv5 認識モデル (単一) を保持
 */

import './onnx-config'
import { loadModel, getRecModelKey } from './model-loader'
import { TextRecognizer } from './text-recognizer'
import type { OCRLanguage } from '../types/ocr'
import type { RecWorkerInMessage, RecWorkerOutMessage } from '../types/recognition-worker'

const DICT_PATHS: Record<OCRLanguage, string> = {
  chinese: '/config/paddleocr/chinese_dict.txt',
  english: '/config/paddleocr/english_dict.txt',
  korean: '/config/paddleocr/korean_dict.txt',
  latin: '/config/paddleocr/latin_dict.txt',
}

let recognizer: TextRecognizer | null = null

self.onmessage = async (e: MessageEvent<RecWorkerInMessage>) => {
  const msg = e.data

  if (msg.type === 'REC_INIT') {
    const language: OCRLanguage = msg.language ?? 'chinese'
    try {
      const recModelKey = getRecModelKey(language)
      const recData = await loadModel(recModelKey, (p) => {
        self.postMessage({ type: 'REC_PROGRESS', progress: p } satisfies RecWorkerOutMessage)
      })
      recognizer = new TextRecognizer(DICT_PATHS[language])
      await recognizer.initialize(recData)

      self.postMessage({ type: 'REC_READY' } satisfies RecWorkerOutMessage)
    } catch (err) {
      self.postMessage({ type: 'REC_ERROR', error: (err as Error).message } satisfies RecWorkerOutMessage)
    }
  } else if (msg.type === 'REC_PROCESS') {
    try {
      const results: Array<{ id: number; text: string; confidence: number }> = []
      for (const job of msg.jobs) {
        const r = await recognizer!.recognizeCropped(job.croppedImageData)
        results.push({ id: job.id, text: r.text, confidence: r.confidence })
      }
      self.postMessage({ type: 'REC_COMPLETE', results } satisfies RecWorkerOutMessage)
    } catch (err) {
      self.postMessage({ type: 'REC_ERROR', error: (err as Error).message } satisfies RecWorkerOutMessage)
    }
  } else if (msg.type === 'REC_TERMINATE') {
    recognizer?.dispose()
    self.close()
  }
}
