import { describe, it, expect } from 'vitest'
import {
  documentsReducer, initialDocumentsState, selectedDocument, recognizableDocuments,
  completedResults, statusCounts, type DocumentsState,
} from '../../src/state/documents'
import type { OCRResult, ProcessedImage } from '../../src/types/ocr'

const img = (fileName: string, pageIndex?: number): ProcessedImage => ({
  fileName,
  pageIndex,
  imageData: { width: 1, height: 1, data: new Uint8ClampedArray(4) } as unknown as ImageData,
  thumbnailDataUrl: `thumb:${fileName}:${pageIndex ?? ''}`,
})

const result = (fileName: string): OCRResult => ({
  id: fileName, fileName, imageDataUrl: 'x', textBlocks: [], fullText: 'text', processingTimeMs: 1, createdAt: 0,
})

function withDocs(): DocumentsState {
  return documentsReducer(initialDocumentsState, {
    type: 'add',
    images: [img('a.png'), img('b.pdf', 1), img('b.pdf', 2)],
    ids: ['a', 'b1', 'b2'],
  })
}

describe('資料の状態管理', () => {
  it('追加すると未処理として並び、最初の追加分が選択される', () => {
    const s = withDocs()
    expect(s.docs.map((d) => [d.id, d.name, d.status])).toEqual([
      ['a', 'a.png', 'pending'], ['b1', 'b.pdf (p.1)', 'pending'], ['b2', 'b.pdf (p.2)', 'pending'],
    ])
    expect(s.selectedId).toBe('a')
    const s2 = documentsReducer(s, { type: 'add', images: [img('c.png')], ids: ['c'] })
    expect(s2.docs).toHaveLength(4)
    expect(s2.selectedId).toBe('c')
  })

  it('状態遷移: 未処理 → 認識中 → 完了 / エラー → 再認識で未処理に戻る', () => {
    let s = withDocs()
    s = documentsReducer(s, { type: 'start', id: 'a' })
    expect(s.docs[0].status).toBe('processing')
    s = documentsReducer(s, { type: 'complete', id: 'a', result: result('a.png') })
    expect(s.docs[0].status).toBe('done')
    expect(s.docs[0].result?.fullText).toBe('text')
    s = documentsReducer(s, { type: 'fail', id: 'b1', error: 'boom' })
    expect(s.docs[1]).toMatchObject({ status: 'error', error: 'boom' })
    s = documentsReducer(s, { type: 'reset', id: 'a' })
    expect(s.docs[0]).toMatchObject({ status: 'pending', result: undefined })
  })

  it('認識対象は元画像がある未処理・エラーのみ（順序を保つ）', () => {
    let s = withDocs()
    s = documentsReducer(s, { type: 'complete', id: 'a', result: result('a.png') })
    s = documentsReducer(s, { type: 'fail', id: 'b2', error: 'x' })
    expect(recognizableDocuments(s).map((d) => d.id)).toEqual(['b1', 'b2'])
    expect(completedResults(s).map((r) => r.fileName)).toEqual(['a.png'])
    expect(statusCounts(s)).toEqual({ pending: 1, processing: 0, done: 1, error: 1 })
  })

  it('選択中の資料を削除すると次（末尾なら前）が選択される', () => {
    let s = documentsReducer(withDocs(), { type: 'select', id: 'b1' })
    s = documentsReducer(s, { type: 'remove', id: 'b1' })
    expect(s.selectedId).toBe('b2')
    s = documentsReducer(s, { type: 'remove', id: 'b2' })
    expect(s.selectedId).toBe('a')
    s = documentsReducer(s, { type: 'remove', id: 'a' })
    expect(s.selectedId).toBeNull()
  })

  it('↑↓（offset）で選択を移動し、端で止まる', () => {
    let s = withDocs()
    s = documentsReducer(s, { type: 'selectOffset', offset: 1 })
    expect(selectedDocument(s)?.id).toBe('b1')
    s = documentsReducer(s, { type: 'selectOffset', offset: 5 })
    expect(s.selectedId).toBe('b2')
    s = documentsReducer(s, { type: 'selectOffset', offset: -9 })
    expect(s.selectedId).toBe('a')
  })

  it('履歴から復元した資料は完了状態で、再認識対象にならない', () => {
    const s = documentsReducer(withDocs(), { type: 'restore', results: [result('old.png')] })
    expect(s.docs).toHaveLength(1)
    expect(s.docs[0]).toMatchObject({ status: 'done', image: null, name: 'old.png' })
    expect(recognizableDocuments(s)).toHaveLength(0)
  })

  it('存在しない ID の選択は無視', () => {
    const s = withDocs()
    expect(documentsReducer(s, { type: 'select', id: 'zzz' })).toBe(s)
  })
})
