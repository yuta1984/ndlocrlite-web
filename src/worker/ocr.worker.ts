/**
 * OCR Web Worker（レイアウト検出担当）
 *
 * レイアウト検出（DEIM）は WebGPU が使えれば WebGPU、使えなければ WASM マルチスレッドで実行する。
 *
 * メッセージ種別:
 *   LAYOUT_DETECT : レイアウト検出のみ実行し、行画像を切り出して LAYOUT_DONE を返す
 *                   認識フェーズはメインスレッドが認識 Worker プールに分配する（デスクトップ）
 *   OCR_PROCESS   : レイアウト検出 + 認識 + 読み順をこの Worker 内で完結
 *                   （認識 Worker を持たない standalone モード = モバイルで使用）
 */

import { configureWasmThreads } from './ort-webgpu'
import { isWebGPUAvailable, type ExecutionBackend } from './onnx-config'
import { loadModel } from './model-loader'
import { LayoutDetector } from './layout-detector'
import { RecognizerSet } from './recognizer-set'
import { recognizeCascade, serialize } from './cascade'
import { assemblePage } from './assemble'
import { cropRGBA, type RGBAImage } from './image-ops'
import { TableRunner, type TableLine } from './table-runner'
import type { WorkerInMessage, WorkerOutMessage, ModelProgress } from '../types/worker'

type InitOptions = Extract<WorkerInMessage, { type: 'INITIALIZE' }>

class OCRWorker {
  private layoutDetector: LayoutDetector | null = null
  private recognizers: RecognizerSet | null = null
  private initPromise: Promise<void> | null = null
  private standalone = false
  private tableRunner: TableRunner | null = null
  backend: ExecutionBackend = 'wasm'

  private get tables(): TableRunner {
    if (!this.tableRunner) this.tableRunner = new TableRunner(this.backend)
    return this.tableRunner
  }

  private post(message: WorkerOutMessage, transfer: Transferable[] = []) {
    self.postMessage(message, { transfer })
  }

  initialize(options: InitOptions = { type: 'INITIALIZE' }): Promise<void> {
    if (!this.initPromise) {
      this.standalone = options.standalone ?? false
      this.initPromise = this.doInitialize(options).catch((error) => {
        this.initPromise = null
        this.post({ type: 'OCR_ERROR', error: (error as Error).message, stage: 'initialization' })
        throw error
      })
    }
    return this.initPromise
  }

  private async doInitialize(options: InitOptions): Promise<void> {
    this.post({ type: 'OCR_PROGRESS', stage: 'initializing', progress: 0.02, message: 'Initializing...' })
    configureWasmThreads(options.wasmThreads ?? 1)

    const progresses: ModelProgress = { layout: 0, rec30: 0, rec50: 0, rec100: 0 }
    const report = () => {
      const p = this.standalone ? (progresses.layout + progresses.rec100) / 2 : progresses.layout
      this.post({
        type: 'OCR_PROGRESS',
        stage: 'loading_models',
        progress: 0.02 + p * 0.73,
        message: `Loading models... ${Math.round(p * 100)}%`,
        modelProgress: { ...progresses },
      })
    }

    // standalone（モバイル）: rec100 もこの Worker で保持
    // ダウンロードは並列に行うが、同一 ORT インスタンスでのセッション生成は直列にする
    // （WebGPU セッションと WASM セッションを同時に生成するとハングするため）
    const recDownload = this.standalone
      ? loadModel('recognition100', (p) => { progresses.rec100 = p; report() })
      : null

    const layoutData = await loadModel('layout', (p) => { progresses.layout = p; report() })
    this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.8, message: 'Preparing layout model...' })
    this.layoutDetector = await this.createLayoutDetector(layoutData, options.backend ?? 'auto')
    if (recDownload) {
      await recDownload
      this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.9, message: 'Preparing recognition model...' })
      this.recognizers = new RecognizerSet(true)
      await this.recognizers.load()
    }

    this.post({ type: 'OCR_PROGRESS', stage: 'initialized', progress: 1.0, message: 'Ready', backend: this.backend })
  }

  /** WebGPU でセッション作成 + ウォームアップ（シェーダーコンパイル）。失敗したら WASM にフォールバック */
  private async createLayoutDetector(modelData: ArrayBuffer, preference: 'auto' | 'wasm'): Promise<LayoutDetector> {
    if (preference === 'auto' && (await isWebGPUAvailable())) {
      const detector = new LayoutDetector()
      try {
        await detector.initialize(modelData, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' })
        await detector.detect({ data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 })
        this.backend = 'webgpu'
        return detector
      } catch (err) {
        console.warn('WebGPU unavailable for layout model, falling back to WASM:', err)
        detector.dispose()
      }
    }
    const detector = new LayoutDetector()
    await detector.initialize(modelData, { executionProviders: ['wasm'] })
    this.backend = 'wasm'
    return detector
  }

  private async detect(id: string, image: RGBAImage, silent = false) {
    if (!silent) {
      this.post({ type: 'OCR_PROGRESS', id, stage: 'layout_detection', progress: 0.1, message: 'Detecting text regions...' })
    }
    return this.layoutDetector!.detect(image, (p) => {
      if (silent) return
      this.post({
        type: 'OCR_PROGRESS', id, stage: 'layout_detection',
        progress: 0.1 + p * 0.3, message: `Detecting regions... ${Math.round(p * 100)}%`,
      })
    })
  }

  /** レイアウト検出 + カスケード認識 + 読み順（standalone モード用） */
  async processOCR(id: string, image: RGBAImage, startTime: number, tableStructure = false): Promise<void> {
    try {
      await this.initialize()
      if (!this.recognizers) {
        this.recognizers = new RecognizerSet(true)
      }
      const recognizers = this.recognizers
      await recognizers.load()
      const { lines, blocks, tables: tableRegions } = await this.detect(id, image)

      this.post({
        type: 'OCR_PROGRESS', id, stage: 'text_recognition', progress: 0.4,
        message: `Recognizing text in ${lines.length} regions...`,
      })

      let done = 0
      const recognize = serialize(async (model, img) => {
        const text = await recognizers.recognize(model, img)
        done++
        this.post({
          type: 'OCR_PROGRESS', id, stage: 'text_recognition',
          progress: 0.4 + (done / Math.max(1, lines.length)) * 0.5,
          message: `Recognized ${done}/${lines.length} regions`,
        })
        return text
      })

      const texts = await recognizeCascade(
        lines.map((r) => ({ image: cropRGBA(image, r.x, r.y, r.width, r.height), charCountCategory: r.charCountCategory })),
        recognize,
        { useCategory: !recognizers.singleModel }
      )

      const page = assemblePage(lines, texts, blocks)
      let tables: Awaited<ReturnType<TableRunner['infer']>> | undefined
      if (tableStructure && tableRegions.length > 0) {
        this.post({ type: 'OCR_PROGRESS', id, stage: 'table_structure', progress: 0.95, message: 'Recognizing table structure...' })
        tables = await this.tables.infer(image, tableRegions, page.textBlocks)
      }
      this.post({
        type: 'OCR_COMPLETE',
        id,
        textBlocks: page.textBlocks,
        txt: page.fullText,
        processingTime: Date.now() - startTime,
        pageBlocks: blocks,
        tables,
      })
    } catch (error) {
      this.post({ type: 'OCR_ERROR', id, error: (error as Error).message })
    }
  }

  /** 表構造推定（認識済みの行テキストをセルに割り当てる） */
  async inferTables(id: string, image: RGBAImage, regions: Parameters<TableRunner['infer']>[1], lines: TableLine[]): Promise<void> {
    try {
      await this.initialize()
      const tables = await this.tables.infer(image, regions, lines)
      this.post({ type: 'TABLE_DONE', id, tables })
    } catch (error) {
      this.post({ type: 'OCR_ERROR', id, error: (error as Error).message })
    }
  }

  /** レイアウト検出のみ実行し、行画像を切り出して返す */
  async detectLayout(id: string, image: RGBAImage, startTime: number, silent = false): Promise<void> {
    try {
      await this.initialize()
      const { lines, blocks, tables } = await this.detect(id, image, silent)
      const croppedImages = lines.map((r) => cropRGBA(image, r.x, r.y, r.width, r.height))
      this.post(
        { type: 'LAYOUT_DONE', id, textRegions: lines, croppedImages, pageBlocks: blocks, tableRegions: tables, startTime },
        croppedImages.map((img) => img.data.buffer as ArrayBuffer)
      )
    } catch (error) {
      this.post({ type: 'OCR_ERROR', id, error: (error as Error).message })
    }
  }
}

const ocrWorker = new OCRWorker()

// メッセージは到着順に 1 件ずつ処理する（同一セッションへの同時 run を防ぐ。先読み要求もキューに並ぶ）
let queue: Promise<void> = Promise.resolve()
self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  if (event.data.type === 'TERMINATE') {
    self.close()
    return
  }
  queue = queue.then(() => handleMessage(event.data)).catch(() => undefined)
}

async function handleMessage(message: WorkerInMessage) {
  switch (message.type) {
    case 'INITIALIZE':
      await ocrWorker.initialize(message).catch(() => undefined)
      break
    case 'OCR_PROCESS':
      await ocrWorker.processOCR(message.id, message.imageData, message.startTime, message.tableStructure)
      break
    case 'LAYOUT_DETECT':
      await ocrWorker.detectLayout(message.id, message.imageData, message.startTime, message.silent)
      break
    case 'TABLE_INFER':
      await ocrWorker.inferTables(message.id, message.imageData, message.regions, message.lines)
      break
    default:
      break
  }
}

self.onerror = (error) => {
  const message = typeof error === 'string' ? error : (error as ErrorEvent).message ?? 'Unknown error'
  self.postMessage({ type: 'OCR_ERROR', error: message } satisfies WorkerOutMessage)
}
