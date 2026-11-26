/**
 * 表構造推定（TableCenterNet）の Worker 内ランナー
 * - モデル（約 28MB）は初回利用時にのみダウンロード（IndexedDB にキャッシュ）
 * - レイアウト検出と同じ実行バックエンド（WebGPU / WASM）を使う
 */

import { loadModel } from './model-loader'
import { TableStructureRecognizer, inferTablesFromPage } from './table/tablecenternet'
import type { ExecutionBackend } from './onnx-config'
import type { RGBAImage } from './image-ops'
import type { TableRegion, TableStructure } from '../types/ocr'

export interface TableLine { x: number; y: number; width: number; height: number; text: string }

export class TableRunner {
  private recognizer: TableStructureRecognizer | null = null
  private loading: Promise<TableStructureRecognizer> | null = null
  private backend: ExecutionBackend

  constructor(backend: ExecutionBackend) {
    this.backend = backend
  }

  private ensure(): Promise<TableStructureRecognizer> {
    if (this.recognizer) return Promise.resolve(this.recognizer)
    if (!this.loading) {
      this.loading = (async () => {
        const data = await loadModel('table')
        let rec = new TableStructureRecognizer()
        if (this.backend === 'webgpu') {
          try {
            await rec.initialize(data, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' })
            this.recognizer = rec
            return rec
          } catch (err) {
            console.warn('WebGPU unavailable for table model, falling back to WASM:', err)
            rec.dispose()
            rec = new TableStructureRecognizer()
          }
        }
        await rec.initialize(data, { executionProviders: ['wasm'] })
        this.recognizer = rec
        return rec
      })()
      this.loading.catch(() => { this.loading = null })
    }
    return this.loading
  }

  async infer(image: RGBAImage, regions: TableRegion[], lines: TableLine[]): Promise<TableStructure[]> {
    if (regions.length === 0) return []
    const recognizer = await this.ensure()
    const results = await inferTablesFromPage(image, regions, lines, recognizer)
    return results.map((t) => ({
      tableIndex: t.tableIndex,
      layoutBbox: t.layoutBbox,
      html: t.html,
      markdown: t.markdown,
      ...(t.error ? { error: t.error } : {}),
    }))
  }
}
