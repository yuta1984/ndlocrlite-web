/**
 * 資料（画像 1 枚 = 1 資料）の状態管理
 * 画像・処理状態・認識結果を 1 つのレコードにまとめ、サイドバーの一覧・選択・一括処理の基盤にする
 * React 非依存の純粋な reducer（単体テスト対象）
 */

import type { OCRResult, ProcessedImage } from '../types/ocr'

export type DocStatus = 'pending' | 'processing' | 'done' | 'error'

export interface OcrDocument {
  id: string
  /** 表示名（PDF/TIFF はページ番号付き） */
  name: string
  thumbnailDataUrl: string
  /** 元画像（履歴から復元した資料は持たない） */
  image: ProcessedImage | null
  status: DocStatus
  result?: OCRResult
  error?: string
}

export interface DocumentsState {
  docs: OcrDocument[]
  selectedId: string | null
}

export const initialDocumentsState: DocumentsState = { docs: [], selectedId: null }

export type DocumentsAction =
  | { type: 'add'; images: ProcessedImage[]; ids?: string[] }
  | { type: 'restore'; results: OCRResult[] }
  | { type: 'remove'; id: string }
  | { type: 'clear' }
  | { type: 'select'; id: string }
  | { type: 'selectOffset'; offset: number }
  | { type: 'start'; id: string }
  | { type: 'complete'; id: string; result: OCRResult }
  | { type: 'fail'; id: string; error: string }
  | { type: 'reset'; id: string }

let counter = 0
export function newDocId(): string {
  counter += 1
  return `doc-${Date.now().toString(36)}-${counter}`
}

export function displayName(image: { fileName: string; pageIndex?: number }): string {
  return image.pageIndex ? `${image.fileName} (p.${image.pageIndex})` : image.fileName
}

function update(state: DocumentsState, id: string, patch: Partial<OcrDocument>): DocumentsState {
  return { ...state, docs: state.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)) }
}

export function documentsReducer(state: DocumentsState, action: DocumentsAction): DocumentsState {
  switch (action.type) {
    case 'add': {
      if (action.images.length === 0) return state
      const added: OcrDocument[] = action.images.map((image, i) => ({
        id: action.ids?.[i] ?? newDocId(),
        name: displayName(image),
        thumbnailDataUrl: image.thumbnailDataUrl,
        image,
        status: 'pending',
      }))
      // 追加した最初の資料を選択する
      return { docs: [...state.docs, ...added], selectedId: added[0].id }
    }
    case 'restore': {
      const docs: OcrDocument[] = action.results.map((result) => ({
        id: newDocId(),
        name: result.fileName,
        thumbnailDataUrl: result.imageDataUrl,
        image: null,
        status: 'done',
        result,
      }))
      return { docs, selectedId: docs[0]?.id ?? null }
    }
    case 'remove': {
      const index = state.docs.findIndex((d) => d.id === action.id)
      if (index < 0) return state
      const docs = state.docs.filter((d) => d.id !== action.id)
      let selectedId = state.selectedId
      if (selectedId === action.id) {
        // 削除した資料の次（末尾なら前）を選択
        selectedId = docs[Math.min(index, docs.length - 1)]?.id ?? null
      }
      return { docs, selectedId }
    }
    case 'clear':
      return initialDocumentsState
    case 'select':
      return state.docs.some((d) => d.id === action.id) ? { ...state, selectedId: action.id } : state
    case 'selectOffset': {
      if (state.docs.length === 0) return state
      const index = state.docs.findIndex((d) => d.id === state.selectedId)
      const next = Math.min(Math.max((index < 0 ? 0 : index) + action.offset, 0), state.docs.length - 1)
      return { ...state, selectedId: state.docs[next].id }
    }
    case 'start':
      return update(state, action.id, { status: 'processing', error: undefined })
    case 'complete':
      return update(state, action.id, { status: 'done', result: action.result, error: undefined })
    case 'fail':
      return update(state, action.id, { status: 'error', error: action.error })
    case 'reset':
      return update(state, action.id, { status: 'pending', result: undefined, error: undefined })
    default:
      return state
  }
}

// --- selectors --------------------------------------------------------------

export function selectedDocument(state: DocumentsState): OcrDocument | null {
  return state.docs.find((d) => d.id === state.selectedId) ?? null
}

/** 認識可能（元画像があり、未処理またはエラー）な資料 */
export function recognizableDocuments(state: DocumentsState): OcrDocument[] {
  return state.docs.filter((d) => d.image && (d.status === 'pending' || d.status === 'error'))
}

export function completedResults(state: DocumentsState): OCRResult[] {
  return state.docs.flatMap((d) => (d.status === 'done' && d.result ? [d.result] : []))
}

export function statusCounts(state: DocumentsState): Record<DocStatus, number> {
  const counts: Record<DocStatus, number> = { pending: 0, processing: 0, done: 0, error: 0 }
  for (const d of state.docs) counts[d.status]++
  return counts
}
