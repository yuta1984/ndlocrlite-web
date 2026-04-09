/**
 * OCR Web Worker
 * PaddleOCR PP-OCRv5 ベース
 *
 * メッセージ種別:
 *   OCR_PROCESS   : 領域OCR用（逐次認識。processRegion で使用）
 *   LAYOUT_DETECT : バッチOCR用（レイアウト検出のみ実行し LAYOUT_DONE を返す）
 *                   認識フェーズはメインスレッドが N 本の recognition.worker に並列委譲する
 */

import './onnx-config'
import { loadModel, getRecModelKey } from './model-loader'
import { LayoutDetector } from './layout-detector'
import { TextRecognizer } from './text-recognizer'
import { ReadingOrderProcessor } from './reading-order'
import type { TextBlock, OCRLanguage } from '../types/ocr'
import type { WorkerInMessage, WorkerOutMessage } from '../types/worker'

// 言語→辞書パスのマッピング
const DICT_PATHS: Record<OCRLanguage, string> = {
  chinese: '/config/paddleocr/chinese_dict.txt',
  english: '/config/paddleocr/english_dict.txt',
  korean: '/config/paddleocr/korean_dict.txt',
  latin: '/config/paddleocr/latin_dict.txt',
}

class OCRWorker {
  private layoutDetector: LayoutDetector | null = null
  private recognizer: TextRecognizer | null = null
  private readingOrderProcessor = new ReadingOrderProcessor()
  private isInitialized = false
  private language: OCRLanguage = 'chinese'

  private post(message: WorkerOutMessage) {
    self.postMessage(message)
  }

  async initialize(layoutOnly = false, language: OCRLanguage = 'chinese'): Promise<void> {
    if (this.isInitialized) return
    this.language = language

    try {
      this.post({
        type: 'OCR_PROGRESS',
        stage: 'initializing',
        progress: 0.02,
        message: 'Initializing...',
      })

      if (layoutOnly) {
        // モバイル: 検出モデルのみロード（認識モデルは processOCR 時に遅延ロード）
        const detModelData = await loadModel('det', (p) => {
          this.post({
            type: 'OCR_PROGRESS',
            stage: 'loading_models',
            progress: 0.02 + p * 0.73,
            message: `Loading detection model... ${Math.round(p * 100)}%`,
            modelProgress: { det: p, rec: 0 },
          })
        })
        this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.76, message: 'Preparing detection model...' })
        this.layoutDetector = new LayoutDetector()
        await this.layoutDetector.initialize(detModelData)
      } else {
        // デスクトップ: det + rec を並列ダウンロード
        const recModelKey = getRecModelKey(language)
        const progresses = { det: 0, rec: 0 }
        const reportProgress = () => {
          const avg = (progresses.det + progresses.rec) / 2
          this.post({
            type: 'OCR_PROGRESS',
            stage: 'loading_models',
            progress: 0.02 + avg * 0.73,
            message: `Loading models... ${Math.round(avg * 100)}%`,
            modelProgress: { ...progresses },
          })
        }

        const [detModelData, recModelData] = await Promise.all([
          loadModel('det', (p) => { progresses.det = p; reportProgress() }),
          loadModel(recModelKey, (p) => { progresses.rec = p; reportProgress() }),
        ])

        // ONNXセッション作成
        this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.76, message: 'Preparing detection model...' })
        this.layoutDetector = new LayoutDetector()
        await this.layoutDetector.initialize(detModelData)

        this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.90, message: 'Preparing recognition model...' })
        this.recognizer = new TextRecognizer(DICT_PATHS[language])
        await this.recognizer.initialize(recModelData)
      }

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

  /** 認識モデルを遅延ロード（layoutOnly モードで processOCR が呼ばれた場合） */
  private async ensureRecognizer(): Promise<void> {
    if (this.recognizer) return

    const recModelKey = getRecModelKey(this.language)
    const recModelData = await loadModel(recModelKey)
    this.recognizer = new TextRecognizer(DICT_PATHS[this.language])
    await this.recognizer.initialize(recModelData)
  }

  /** 領域OCR用: レイアウト検出 + 逐次認識 + 読み順処理 (processRegion から使用) */
  async processOCR(id: string, imageData: ImageData, startTime: number): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize()
      }
      await this.ensureRecognizer()

      // Stage 1: レイアウト検出
      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'layout_detection',
        progress: 0.1,
        message: 'Detecting text regions...',
      })

      const { lines: textRegions } = await this.layoutDetector!.detect(
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

      // Stage 2: 逐次文字認識
      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'text_recognition',
        progress: 0.4,
        message: `Recognizing text in ${textRegions.length} regions...`,
      })

      const croppedImages = TextRecognizer.cropImageDataBatch(imageData, textRegions)
      const recognitionResults: TextBlock[] = []
      for (let i = 0; i < textRegions.length; i++) {
        const region = textRegions[i]
        const result = await this.recognizer!.recognizeCropped(croppedImages[i])

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

      const orderedResults = this.readingOrderProcessor.process(recognitionResults, [])

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

  /** バッチOCR用: レイアウト検出のみ実行し LAYOUT_DONE を返す */
  async detectLayout(id: string, imageData: ImageData, startTime: number): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize()
      }

      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'layout_detection',
        progress: 0.1,
        message: 'Detecting text regions...',
      })

      const { lines: textRegions, blocks: pageBlocks } = await this.layoutDetector!.detect(
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

      // 各領域を事前クロップ（メインスレッドに Transferable で返す）
      const croppedImages = TextRecognizer.cropImageDataBatch(imageData, textRegions)
      const transferables = croppedImages.map(img => img.data.buffer)

      self.postMessage(
        { type: 'LAYOUT_DONE', id, textRegions, croppedImages, pageBlocks, startTime } satisfies WorkerOutMessage,
        { transfer: transferables }
      )
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
      await ocrWorker.initialize(message.layoutOnly, message.language)
      break

    case 'OCR_PROCESS':
      await ocrWorker.processOCR(message.id, message.imageData, message.startTime)
      break

    case 'LAYOUT_DETECT':
      await ocrWorker.detectLayout(message.id, message.imageData, message.startTime)
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
