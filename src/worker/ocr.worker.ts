/**
 * OCR Web Worker
 * バックグラウンドでOCR処理を実行
 * 参照実装: ndlkotenocr-worker/src/worker/ocr-worker.js
 *
 * カスケード文字認識:
 *   charCountCategory=3 → recognizer30 (16×256, ≤30文字)
 *   charCountCategory=2 → recognizer50 (16×384, ≤50文字)
 *   それ以外            → recognizer100 (16×768, ≤100文字)
 */

import './onnx-config'
import { loadModel } from './model-loader'
import { LayoutDetector } from './layout-detector'
import { TextRecognizer } from './text-recognizer'
import { ReadingOrderProcessor } from './reading-order'
import type { TextBlock, TextRegion } from '../types/ocr'
import type { WorkerInMessage, WorkerOutMessage } from '../types/worker'

class OCRWorker {
  private layoutDetector: LayoutDetector | null = null
  private recognizer30: TextRecognizer | null = null  // ≤30文字 [1,3,16,256]
  private recognizer50: TextRecognizer | null = null  // ≤50文字 [1,3,16,384]
  private recognizer100: TextRecognizer | null = null // ≤100文字 [1,3,16,768]
  private readingOrderProcessor = new ReadingOrderProcessor()
  private isInitialized = false

  private post(message: WorkerOutMessage) {
    self.postMessage(message)
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return

    try {
      this.post({
        type: 'OCR_PROGRESS',
        stage: 'initializing',
        progress: 0.02,
        message: 'Initializing...',
      })

      // 4モデルを並列ダウンロード（各モデルの進捗を合算してレポート）
      const progresses = { layout: 0, rec30: 0, rec50: 0, rec100: 0 }
      const reportProgress = () => {
        const avg = (progresses.layout + progresses.rec30 + progresses.rec50 + progresses.rec100) / 4
        this.post({
          type: 'OCR_PROGRESS',
          stage: 'loading_models',
          progress: 0.02 + avg * 0.73,
          message: `Loading models... ${Math.round(avg * 100)}%`,
          modelProgress: { ...progresses },
        })
      }

      const [layoutModelData, rec30Data, rec50Data, rec100Data] = await Promise.all([
        loadModel('layout',        (p) => { progresses.layout = p; reportProgress() }),
        loadModel('recognition30', (p) => { progresses.rec30  = p; reportProgress() }),
        loadModel('recognition50', (p) => { progresses.rec50  = p; reportProgress() }),
        loadModel('recognition100',(p) => { progresses.rec100 = p; reportProgress() }),
      ])

      // ONNXセッション作成（WASMシングルスレッドのため直列）
      this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.76, message: 'Preparing layout model...' })
      this.layoutDetector = new LayoutDetector()
      await this.layoutDetector.initialize(layoutModelData)

      this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.83, message: 'Preparing recognition model (30)...' })
      this.recognizer30 = new TextRecognizer([1, 3, 16, 256])
      await this.recognizer30.initialize(rec30Data)

      this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.90, message: 'Preparing recognition model (50)...' })
      this.recognizer50 = new TextRecognizer([1, 3, 16, 384])
      await this.recognizer50.initialize(rec50Data)

      this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.96, message: 'Preparing recognition model (100)...' })
      this.recognizer100 = new TextRecognizer([1, 3, 16, 768])
      await this.recognizer100.initialize(rec100Data)

      this.isInitialized = true

      this.post({
        type: 'OCR_PROGRESS',
        stage: 'initialized',
        progress: 1.0,
        message: 'Ready',
      })
    } catch (error) {
      this.post({
        type: 'OCR_ERROR',
        error: (error as Error).message,
        stage: 'initialization',
      })
      throw error
    }
  }

  /** charCountCategory に応じたモデルを選択 */
  private selectRecognizer(charCountCategory?: number): TextRecognizer {
    if (charCountCategory === 3) return this.recognizer30!
    if (charCountCategory === 2) return this.recognizer50!
    return this.recognizer100!
  }

  async processOCR(id: string, imageData: ImageData, startTime: number): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize()
      }

      // Stage 1: レイアウト検出
      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'layout_detection',
        progress: 0.1,
        message: 'Detecting text regions...',
      })

      const textRegions: TextRegion[] = await this.layoutDetector!.detect(
        imageData,
        (progress) => {
          this.post({
            type: 'OCR_PROGRESS',
            id,
            stage: 'layout_detection',
            progress: 0.1 + progress * 0.3,
            message: `Detecting regions... ${Math.round(progress * 100)}%`,
          })
        }
      )

      // Stage 2: カスケード文字認識
      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'text_recognition',
        progress: 0.4,
        message: `Recognizing text in ${textRegions.length} regions...`,
      })

      const recognitionResults: TextBlock[] = []
      for (let i = 0; i < textRegions.length; i++) {
        const region = textRegions[i]
        const recognizer = this.selectRecognizer(region.charCountCategory)
        const result = await recognizer.recognize(imageData, region)

        recognitionResults.push({
          ...region,
          text: result.text,
          readingOrder: i + 1,
        })

        this.post({
          type: 'OCR_PROGRESS',
          id,
          stage: 'text_recognition',
          progress: 0.4 + ((i + 1) / textRegions.length) * 0.4,
          message: `Recognized ${i + 1}/${textRegions.length} regions`,
        })
      }

      // Stage 3: 読み順処理
      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'reading_order',
        progress: 0.8,
        message: 'Processing reading order...',
      })

      const orderedResults = this.readingOrderProcessor.process(recognitionResults)

      // Stage 4: 出力生成
      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'generating_output',
        progress: 0.9,
        message: 'Generating output...',
      })

      const txt = orderedResults
        .filter((b) => b.text)
        .map((b) => b.text)
        .join('\n')

      this.post({
        type: 'OCR_COMPLETE',
        id,
        textBlocks: orderedResults,
        txt,
        processingTime: Date.now() - startTime,
      })
    } catch (error) {
      this.post({
        type: 'OCR_ERROR',
        id,
        error: (error as Error).message,
      })
    }
  }
}

const ocrWorker = new OCRWorker()

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const message = event.data

  switch (message.type) {
    case 'INITIALIZE':
      await ocrWorker.initialize()
      break

    case 'OCR_PROCESS':
      await ocrWorker.processOCR(message.id, message.imageData, message.startTime)
      break

    case 'TERMINATE':
      self.close()
      break
  }
}

self.onerror = (error) => {
  const message = typeof error === 'string' ? error : (error as ErrorEvent).message ?? 'Unknown error'
  self.postMessage({
    type: 'OCR_ERROR',
    error: message,
  } satisfies WorkerOutMessage)
}
