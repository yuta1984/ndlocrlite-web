import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { OCRResult, ProcessedImage } from '../types/ocr'
import type { DBRunEntry } from '../types/db'
import {
  documentsReducer, initialDocumentsState, recognizableDocuments, type OcrDocument,
} from '../state/documents'

type ProcessImageFn = (image: ProcessedImage, index: number, total: number, next?: ProcessedImage) => Promise<OCRResult>

/**
 * 資料一覧 + 認識キュー
 * - 画像は何度でも追加でき、「認識」ボタンで未処理（とエラー）の資料を順に認識する
 * - 1 回の認識実行で完了した資料を履歴（IndexedDB）に 1 件として保存する
 */
export function useDocuments(processImage: ProcessImageFn, saveRun: (entry: DBRunEntry) => Promise<void>) {
  const [state, dispatch] = useReducer(documentsReducer, initialDocumentsState)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
  const [isRecognizing, setIsRecognizing] = useState(false)
  const runningRef = useRef(false)

  const addImages = useCallback((images: ProcessedImage[]) => {
    dispatch({ type: 'add', images })
  }, [])

  /** ids を省略すると未処理・エラーの資料すべてを認識 */
  const recognize = useCallback(async (ids?: string[]) => {
    if (runningRef.current) return
    const current = stateRef.current
    const targets: OcrDocument[] = ids
      ? current.docs.filter((d) => ids.includes(d.id) && d.image)
      : recognizableDocuments(current)
    if (targets.length === 0) return

    runningRef.current = true
    setIsRecognizing(true)
    const completed: Array<{ doc: OcrDocument; result: OCRResult }> = []
    try {
      for (let i = 0; i < targets.length; i++) {
        const doc = targets[i]
        // 実行中に削除された資料はスキップ
        if (!stateRef.current.docs.some((d) => d.id === doc.id)) continue
        dispatch({ type: 'start', id: doc.id })
        try {
          const result = await processImage(doc.image!, i, targets.length, targets[i + 1]?.image ?? undefined)
          dispatch({ type: 'complete', id: doc.id, result })
          completed.push({ doc, result })
        } catch (err) {
          console.error(`OCR failed for ${doc.name}:`, err)
          dispatch({ type: 'fail', id: doc.id, error: (err as Error).message })
        }
      }
      if (completed.length > 0) {
        await saveRun({
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          files: completed.map(({ doc, result: r }) => ({
            fileName: r.fileName,
            imageDataUrl: doc.thumbnailDataUrl,
            textBlocks: r.textBlocks,
            fullText: r.fullText,
            processingTimeMs: r.processingTimeMs,
            pageBlocks: r.pageBlocks,
            imageWidth: r.imageWidth,
            imageHeight: r.imageHeight,
            tables: r.tables,
          })),
        }).catch((err) => console.error('Failed to save history:', err))
      }
    } finally {
      runningRef.current = false
      setIsRecognizing(false)
    }
  }, [processImage, saveRun])

  const restore = useCallback((results: OCRResult[]) => dispatch({ type: 'restore', results }), [])
  const select = useCallback((id: string) => dispatch({ type: 'select', id }), [])
  const selectOffset = useCallback((offset: number) => dispatch({ type: 'selectOffset', offset }), [])
  const remove = useCallback((id: string) => dispatch({ type: 'remove', id }), [])
  const clear = useCallback(() => dispatch({ type: 'clear' }), [])

  return { state, isRecognizing, addImages, recognize, restore, select, selectOffset, remove, clear }
}
