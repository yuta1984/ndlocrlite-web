export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface TextRegion extends BoundingBox {
  confidence: number
  classId: number
  charCountCategory?: number // DEIMモデルが出力する文字数カテゴリ (1, 2, 3)
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

/** レイアウト検出された表領域（block_table） */
export interface TableRegion extends BoundingBox {
  confidence: number
}

export interface LayoutDetectionResult {
  lines: TextRegion[]
  blocks: PageBlock[]
  tables: TableRegion[]
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
  imageWidth?: number
  imageHeight?: number
  tables?: TableStructure[] // 表構造推定の結果（有効時のみ）
}

/** 表構造推定の結果（1 表分） */
export interface TableStructure {
  tableIndex: number
  layoutBbox: [number, number, number, number]
  html: string
  markdown: string
  error?: string
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
  modelProgress?: { layout: number; rec30: number; rec50: number; rec100: number }
}
