import type { TextBlock, TextRegion, PageBlock, TableRegion, TableStructure } from './ocr'
import type { RGBAImage } from '../worker/image-ops'

// Workerへ送信するメッセージ
export type WorkerInMessage =
  | {
      type: 'INITIALIZE'
      /** true: 認識 Worker プールを使わない（モバイル）。この Worker 内で rec100 も保持する */
      standalone?: boolean
      /** 'auto': WebGPU が使えれば WebGPU、'wasm': 常に WASM */
      backend?: 'auto' | 'wasm'
      /** WASM フォールバック時のスレッド数 */
      wasmThreads?: number
    }
  | {
      type: 'OCR_PROCESS'
      id: string
      imageData: RGBAImage
      startTime: number
      /** 表構造推定を行う */
      tableStructure?: boolean
    }
  | {
      type: 'TABLE_INFER'
      id: string
      imageData: RGBAImage
      regions: TableRegion[]
      lines: Array<{ x: number; y: number; width: number; height: number; text: string }>
    }
  | {
      type: 'LAYOUT_DETECT'
      id: string
      imageData: RGBAImage
      startTime: number
      /** true: 進捗メッセージを送らない（次ページの先読み用） */
      silent?: boolean
    }
  | { type: 'TERMINATE' }

export interface ModelProgress {
  layout: number
  rec30: number
  rec50: number
  rec100: number
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
      /** stage === 'initialized' のとき、レイアウト検出に使われた実行バックエンド */
      backend?: 'webgpu' | 'wasm'
    }
  | {
      type: 'OCR_COMPLETE'
      id: string
      textBlocks: TextBlock[]
      txt: string
      processingTime: number
      pageBlocks?: PageBlock[]
      tables?: TableStructure[]
    }
  | {
      type: 'TABLE_DONE'
      id: string
      tables: TableStructure[]
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
      croppedImages: RGBAImage[]
      pageBlocks: PageBlock[]
      tableRegions: TableRegion[]
      startTime: number
    }
