export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

/** OCR言語（認識モデル＋辞書の選択に使用） */
export type OCRLanguage = 'chinese' | 'english' | 'korean' | 'latin'

export interface TextRegion extends BoundingBox {
  confidence: number
}

export interface TextBlock extends TextRegion {
  text: string
  readingOrder: number
}

export interface PageBlock {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutDetectionResult {
  lines: TextRegion[]
  blocks: PageBlock[]
}

export interface OCRResult {
  id: string
  fileName: string
  imageDataUrl: string // サムネイル用（縮小版）
  textBlocks: TextBlock[]
  fullText: string
  processingTimeMs: number
  createdAt: number // Unix timestamp (ms)
  pageBlocks?: PageBlock[] // DEIMが検出した段・カラム境界
}

export interface ProcessedImage {
  fileName: string
  pageIndex?: number // PDFのページ番号（1始まり）
  imageData: ImageData
  thumbnailDataUrl: string // 表示用縮小版
}

export type OCRStatus =
  | 'idle'
  | 'loading_model'
  | 'processing'
  | 'done'
  | 'error'

export interface OCRJobState {
  status: OCRStatus
  currentFile: string
  currentFileIndex: number
  totalFiles: number
  stageProgress: number // 現在ステージ内の進捗 0.0-1.0
  stage: string
  message: string
  errorMessage?: string
  modelProgress?: { det: number; rec: number }
}
