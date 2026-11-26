import { useRef, useState, useCallback, useEffect } from 'react'
import type { OCRJobState, OCRResult, ProcessedImage, TextBlock } from '../types/ocr'
import type { WorkerInMessage, WorkerOutMessage } from '../types/worker'
import { padToSize, type RGBAImage } from '../worker/image-ops'
import { imageDataToDataUrl } from '../utils/imageLoader'
import { recognizeCascade } from '../worker/cascade'
import { assemblePage } from '../worker/assemble'
import { getSettings } from '../utils/settings'
import { RecognitionPool } from './recognition-pool'

type LayoutDone = Extract<WorkerOutMessage, { type: 'LAYOUT_DONE' }>
export type ExecutionBackend = 'webgpu' | 'wasm'

/**
 * 実行構成を決める
 * - 認識 Worker 数: 各 Worker が PARSeq 3 モデル（約 117MB + 実行時メモリ）を保持するため上限 4
 *   （?workers=N で上書き可。0 でモバイルと同じ standalone 動作。検証用）
 * - モバイル: 認識 Worker なし（ocr.worker 単体で rec100 のみ使用）
 */
function resolveConfig() {
  const settings = getSettings()
  const param = new URLSearchParams(location.search).get('workers')
  const isMobileUA = /iPhone|iPad|Android/i.test(navigator.userAgent)
  const cores = navigator.hardwareConcurrency ?? 4
  let recWorkers: number
  if (param !== null) recWorkers = Math.max(0, Math.min(16, Number(param) || 0))
  else if (isMobileUA) recWorkers = 0
  else if (settings.recWorkers > 0) recWorkers = Math.min(16, settings.recWorkers)
  else recWorkers = Math.min(Math.max(cores - 2, 2), 4)
  return {
    recWorkers,
    backend: settings.backend,
    // WebGPU 非対応時のレイアウト検出 WASM スレッド数（認識 Worker と CPU を分け合う）
    wasmThreads: Math.min(4, Math.max(1, Math.floor(cores / 2))),
  }
}

const initialJobState: OCRJobState = {
  status: 'idle',
  currentFile: '',
  currentFileIndex: 0,
  totalFiles: 0,
  stageProgress: 0,
  stage: '',
  message: '',
}

/** ImageData を Worker に送るためのプレーンオブジェクト（コピー） */
function toRGBA(imageData: ImageData): RGBAImage {
  return { data: new Uint8ClampedArray(imageData.data), width: imageData.width, height: imageData.height }
}

export function useOCRWorker() {
  const workerRef = useRef<Worker | null>(null)
  const poolRef = useRef<RecognitionPool | null>(null)
  const prefetchRef = useRef(new WeakMap<ProcessedImage, Promise<LayoutDone>>())
  const [isReady, setIsReady] = useState(false)
  const [backend, setBackend] = useState<ExecutionBackend | null>(null)
  const [recWorkerCount, setRecWorkerCount] = useState(0)
  const [jobState, setJobState] = useState<OCRJobState>(initialJobState)

  // OCR Worker（レイアウト検出）+ 認識 Worker プールを起動
  useEffect(() => {
    const config = resolveConfig()
    setRecWorkerCount(config.recWorkers)
    const worker = new Worker(new URL('../worker/ocr.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const pool = config.recWorkers > 0 ? new RecognitionPool(config.recWorkers) : null
    poolRef.current = pool

    let ocrWorkerReady = false
    let poolReady = pool === null
    let poolProgress = pool === null ? 1 : 0
    let layoutProgress = 0
    let disposed = false
    const checkReady = () => {
      if (!disposed && ocrWorkerReady && poolReady) {
        setIsReady(true)
        setJobState(initialJobState)
      }
    }
    const reportLoading = (stage: string, message: string, modelProgress?: OCRJobState['modelProgress']) => {
      if (ocrWorkerReady && poolReady) return
      setJobState((prev) => ({
        ...prev,
        status: 'loading_model',
        stageProgress: (layoutProgress + poolProgress) / 2,
        stage,
        message,
        modelProgress: modelProgress ?? prev.modelProgress,
      }))
    }

    const onInitMessage = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data
      if (msg.type === 'OCR_PROGRESS' && msg.id === undefined) {
        if (msg.stage === 'initialized') {
          ocrWorkerReady = true
          layoutProgress = 1
          if (msg.backend) setBackend(msg.backend)
          worker.removeEventListener('message', onInitMessage)
          checkReady()
        } else {
          layoutProgress = msg.progress
          if (msg.modelProgress) {
            latestModelProgress = pool
              ? { ...(latestModelProgress ?? msg.modelProgress), layout: msg.modelProgress.layout }
              : msg.modelProgress
          }
          reportLoading(msg.stage, msg.message, latestModelProgress)
        }
      } else if (msg.type === 'OCR_ERROR' && msg.id === undefined) {
        setJobState((prev) => ({ ...prev, status: 'error', errorMessage: msg.error }))
      }
    }
    worker.addEventListener('message', onInitMessage)
    worker.postMessage({
      type: 'INITIALIZE',
      standalone: pool === null,
      backend: config.backend,
      wasmThreads: config.wasmThreads,
    } satisfies WorkerInMessage)

    const recProgress = { recognition30: 0, recognition50: 0, recognition100: 0 }
    let latestModelProgress: OCRJobState['modelProgress'] = { layout: 0, rec30: 0, rec50: 0, rec100: 0 }
    pool?.init(false, (model, p) => {
      recProgress[model] = p
      // ダウンロード完了後のセッション生成分を残して 0.9 までをダウンロード進捗とする
      poolProgress = ((recProgress.recognition30 + recProgress.recognition50 + recProgress.recognition100) / 3) * 0.9
      latestModelProgress = {
        ...(latestModelProgress ?? { layout: 0, rec30: 0, rec50: 0, rec100: 0 }),
        rec30: recProgress.recognition30,
        rec50: recProgress.recognition50,
        rec100: recProgress.recognition100,
      }
      reportLoading('loading_models', `Loading models... ${Math.round(((layoutProgress + poolProgress) / 2) * 100)}%`, latestModelProgress)
    })
      .then(() => { poolReady = true; poolProgress = 1; checkReady() })
      .catch((err: Error) => setJobState((prev) => ({ ...prev, status: 'error', errorMessage: err.message })))

    return () => {
      disposed = true
      worker.postMessage({ type: 'TERMINATE' } satisfies WorkerInMessage)
      worker.terminate()
      pool?.terminate()
      workerRef.current = null
      poolRef.current = null
    }
  }, [])

  /** OCR Worker に 1 メッセージ送り、id に対応する完了/エラーを待つ */
  const callWorker = useCallback(
    <T,>(
      message: WorkerInMessage & { id: string },
      onMessage: (msg: WorkerOutMessage) => T | undefined,
      transfer: Transferable[] = []
    ): Promise<T> =>
      new Promise((resolve, reject) => {
        const worker = workerRef.current
        if (!worker) { reject(new Error('Worker not initialized')); return }
        const handler = (event: MessageEvent<WorkerOutMessage>) => {
          const msg = event.data
          if (msg.id !== message.id) return
          if (msg.type === 'OCR_ERROR') {
            worker.removeEventListener('message', handler)
            reject(new Error(msg.error))
            return
          }
          const result = onMessage(msg)
          if (result !== undefined) {
            worker.removeEventListener('message', handler)
            resolve(result)
          }
        }
        worker.addEventListener('message', handler)
        worker.postMessage(message, transfer)
      }),
    []
  )

  const detectLayout = useCallback(
    (imageData: ImageData, id: string, silent: boolean, onProgress?: (msg: WorkerOutMessage) => void) => {
      const rgba = toRGBA(imageData)
      return callWorker<LayoutDone>(
        { type: 'LAYOUT_DETECT', id, imageData: rgba, startTime: Date.now(), silent },
        (msg) => {
          onProgress?.(msg)
          return msg.type === 'LAYOUT_DONE' ? msg : undefined
        },
        [rgba.data.buffer as ArrayBuffer]
      )
    },
    [callWorker]
  )

  /** 表構造推定（ocr.worker で実行） */
  const inferTables = useCallback(
    (imageData: ImageData, id: string, regions: LayoutDone['tableRegions'], lines: TextBlock[]) => {
      const rgba = toRGBA(imageData)
      return callWorker(
        {
          type: 'TABLE_INFER', id, imageData: rgba, regions,
          lines: lines.map(({ x, y, width, height, text }) => ({ x, y, width, height, text })),
        },
        (msg) => (msg.type === 'TABLE_DONE' ? msg.tables : undefined),
        [rgba.data.buffer as ArrayBuffer]
      )
    },
    [callWorker]
  )

  /** 認識 Worker プールでカスケード認識 → 読み順 */
  const recognizeLayout = useCallback(
    async (layout: LayoutDone, onDone?: (done: number, total: number) => void) => {
      const pool = poolRef.current!
      const total = layout.textRegions.length
      let done = 0
      const texts = await recognizeCascade(
        layout.textRegions.map((r, i) => ({ image: layout.croppedImages[i], charCountCategory: r.charCountCategory })),
        async (model, img) => {
          const text = await pool.recognize(model, img)
          onDone?.(++done, total)
          return text
        }
      )
      return assemblePage(layout.textRegions, texts, layout.pageBlocks)
    },
    []
  )

  /**
   * processImage: バッチOCR用
   * デスクトップ: LAYOUT_DETECT → 認識 Worker プールでカスケード認識 → 読み順
   *   next を渡すと、現在ページの認識中に次ページのレイアウト検出を先読みする
   * standalone（モバイル）: OCR_PROCESS（ocr.worker 内で完結）
   */
  const processImage = useCallback(
    async (image: ProcessedImage, fileIndex: number, totalFiles: number, next?: ProcessedImage): Promise<OCRResult> => {
      const id = `${Date.now()}-${fileIndex}`
      const imageDataUrl = imageDataToDataUrl(image.imageData)
      const fileName = image.pageIndex ? `${image.fileName} (p.${image.pageIndex})` : image.fileName
      const startTime = Date.now()

      setJobState({
        status: 'processing',
        currentFile: image.fileName,
        currentFileIndex: fileIndex + 1,
        totalFiles,
        stageProgress: 0,
        stage: 'starting',
        message: '',
      })

      const onProgress = (msg: WorkerOutMessage) => {
        if (msg.type === 'OCR_PROGRESS') {
          setJobState((prev) => ({ ...prev, stageProgress: msg.progress, stage: msg.stage, message: msg.message, status: 'processing' }))
        }
      }

      try {
        let page: { textBlocks: TextBlock[]; fullText: string }
        let pageBlocks: OCRResult['pageBlocks']
        let tables: OCRResult['tables']
        const pool = poolRef.current

        const tableStructure = getSettings().tableStructure
        if (!pool) {
          const rgba = toRGBA(image.imageData)
          const done = await callWorker(
            { type: 'OCR_PROCESS', id, imageData: rgba, startTime, tableStructure },
            (msg) => {
              onProgress(msg)
              return msg.type === 'OCR_COMPLETE' ? msg : undefined
            },
            [rgba.data.buffer as ArrayBuffer]
          )
          page = { textBlocks: done.textBlocks, fullText: done.txt }
          pageBlocks = done.pageBlocks
          tables = done.tables
        } else {
          const prefetched = prefetchRef.current.get(image)
          prefetchRef.current.delete(image)
          const layout = await (prefetched ?? detectLayout(image.imageData, id, false, onProgress))
          pageBlocks = layout.pageBlocks

          // 次ページのレイアウト検出を先読み（ocr.worker は認識中は空いているため）
          if (next && !prefetchRef.current.has(next)) {
            const p = detectLayout(next.imageData, `${id}-prefetch`, true)
            p.catch(() => undefined)
            prefetchRef.current.set(next, p)
          }

          const total = layout.textRegions.length
          setJobState((prev) => ({
            ...prev,
            stageProgress: 0.4,
            stage: 'text_recognition',
            message: `Recognizing text in ${total} regions (${pool.size} threads)...`,
          }))
          page = await recognizeLayout(layout, (done) => {
            setJobState((prev) => ({
              ...prev,
              stageProgress: 0.4 + (done / Math.max(1, total)) * 0.5,
              message: `Recognized ${done}/${total} regions`,
            }))
          })

          if (tableStructure && layout.tableRegions.length > 0) {
            setJobState((prev) => ({ ...prev, stageProgress: 0.92, stage: 'table_structure', message: 'Recognizing table structure...' }))
            tables = await inferTables(image.imageData, `${id}-table`, layout.tableRegions, page.textBlocks)
          }
        }

        setJobState((prev) => ({ ...prev, status: 'done', stageProgress: 1 }))
        return {
          id,
          fileName,
          imageDataUrl,
          textBlocks: page.textBlocks,
          fullText: page.fullText,
          processingTimeMs: Date.now() - startTime,
          createdAt: Date.now(),
          pageBlocks,
          imageWidth: image.imageData.width,
          imageHeight: image.imageData.height,
          tables,
        }
      } catch (err) {
        setJobState((prev) => ({ ...prev, status: 'error', errorMessage: (err as Error).message }))
        throw err
      }
    },
    [callWorker, detectLayout, recognizeLayout, inferTables]
  )

  /**
   * processRegion: 領域OCR用（デスクトップは認識 Worker プールを使用）
   * pageSize（元画像のサイズ）を渡すと、切り出し画像を元ページと同じ大きさの白地に置いてから認識する
   * （小さな領域を 800px に拡大してレイアウト認識すると検出が崩れるため）
   */
  const processRegion = useCallback(
    async (imageData: ImageData, pageSize?: { width: number; height: number }): Promise<{ textBlocks: TextBlock[]; fullText: string }> => {
      const id = `region-${Date.now()}`
      const padded = pageSize ? padToSize(toRGBA(imageData), pageSize.width, pageSize.height) : toRGBA(imageData)
      const input = new ImageData(new Uint8ClampedArray(padded.data), padded.width, padded.height)
      if (poolRef.current) {
        const layout = await detectLayout(input, id, true)
        return recognizeLayout(layout)
      }
      const rgba = toRGBA(input)
      return callWorker(
        { type: 'OCR_PROCESS', id, imageData: rgba, startTime: Date.now() },
        (msg) => (msg.type === 'OCR_COMPLETE' ? { textBlocks: msg.textBlocks, fullText: msg.txt } : undefined),
        [rgba.data.buffer as ArrayBuffer]
      )
    },
    [callWorker, detectLayout, recognizeLayout]
  )

  const resetState = useCallback(() => {
    setJobState(initialJobState)
  }, [])

  return { isReady, backend, recWorkerCount, jobState, processImage, processRegion, resetState }
}
