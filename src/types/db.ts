import type { TextBlock, PageBlock, TableStructure } from './ocr'

export interface DBModelEntry {
  name: string // 'layout' | 'recognition'
  data: ArrayBuffer
  cachedAt: number // Unix timestamp (ms)
  version: string // モデルのバージョン管理用
}

// 1回の実行に含まれる1ファイル分の結果
export interface DBRunFile {
  fileName: string
  imageDataUrl: string // 縮小サムネイル (base64)
  textBlocks: TextBlock[]
  fullText: string
  processingTimeMs: number
  pageBlocks?: PageBlock[]
  imageWidth?: number
  imageHeight?: number
  tables?: TableStructure[]
}

// 1回の実行（複数ファイルをまとめた単位）
export interface DBRunEntry {
  id: string         // runId (UUID)
  files: DBRunFile[] // この実行で処理したファイル一覧
  createdAt: number  // Unix timestamp (ms)
}
