import type { TextBlock, TextRegion, PageBlock, OCRLanguage } from './ocr'

// Workerへ送信するメッセージ
export type WorkerInMessage =
  | { type: 'INITIALIZE'; layoutOnly?: boolean; language?: OCRLanguage }
  | {
      type: 'OCR_PROCESS'
      id: string
      imageData: ImageData
      startTime: number
    }
  | {
      type: 'LAYOUT_DETECT'
      id: string
      imageData: ImageData
      startTime: number
    }
  | { type: 'TERMINATE' }

export interface ModelProgress {
  det: number
  rec: number
}

// Workerから受信するメッセージ
export type WorkerOutMessage =
  | {
      type: 'OCR_PROGRESS'
      id?: string
      stage: string
      progress: number
      message: string
      modelProgress?: ModelProgress
    }
  | {
      type: 'OCR_COMPLETE'
      id: string
      textBlocks: TextBlock[]
      txt: string
      processingTime: number
    }
  | {
      type: 'OCR_ERROR'
      id?: string
      error: string
      stage?: string
    }
  | {
      type: 'LAYOUT_DONE'
      id: string
      textRegions: TextRegion[]
      croppedImages: ImageData[]
      pageBlocks: PageBlock[]
      startTime: number
    }
