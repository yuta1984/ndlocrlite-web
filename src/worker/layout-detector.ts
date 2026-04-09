/**
 * レイアウト検出モジュール（PaddleOCR DB テキスト検出モデル）
 *
 * DB (Differentiable Binarization) モデルの入出力:
 *   入力: 画像テンソル [1, 3, H, W] (ImageNet正規化, BGR)
 *   出力: 確率マップ [1, 1, H, W]
 *
 * 後処理:
 *   1. 二値化 (threshold=0.3)
 *   2. 連結成分抽出 (findContours相当)
 *   3. box_thresh(0.6) フィルタリング
 *   4. unclip (ratio=1.5) でボックス拡張
 *   5. 元画像座標へスケール変換
 */

import type * as OrtType from 'onnxruntime-web'
import { ort, createSession } from './onnx-config'
import type { TextRegion, LayoutDetectionResult } from '../types/ocr'

const LIMIT_SIDE_LEN = 960
const BINARY_THRESH = 0.3
const BOX_THRESH = 0.6
const UNCLIP_RATIO = 1.5
const MIN_BOX_SIZE = 3

interface PreprocessResult {
  tensor: OrtType.Tensor
  metadata: {
    originalWidth: number
    originalHeight: number
    resizedWidth: number
    resizedHeight: number
    ratioW: number
    ratioH: number
  }
}

export class LayoutDetector {
  private session: OrtType.InferenceSession | null = null
  private initialized = false

  async initialize(modelData: ArrayBuffer): Promise<void> {
    if (this.initialized) return

    try {
      this.session = await createSession(modelData)
      this.initialized = true
      console.log(`[LayoutDetector] PaddleOCR DB detector initialized`)
    } catch (error) {
      console.error('Failed to initialize layout detector:', error)
      throw error
    }
  }

  async detect(
    imageData: ImageData,
    onProgress?: (progress: number) => void
  ): Promise<LayoutDetectionResult> {
    if (!this.initialized || !this.session) {
      throw new Error('Layout detector not initialized')
    }

    if (onProgress) onProgress(0.1)
    const { tensor, metadata } = this.preprocessImage(imageData)

    if (onProgress) onProgress(0.4)

    const inputName = this.session.inputNames[0]
    const output = await this.session.run({ [inputName]: tensor })

    if (onProgress) onProgress(0.7)
    const lines = this.postprocessOutput(output, metadata)

    if (onProgress) onProgress(1.0)
    console.log(`[LayoutDetector] ${lines.length} text regions detected`)
    return { lines, blocks: [] }
  }

  private preprocessImage(imageData: ImageData): PreprocessResult {
    const { width: origW, height: origH } = imageData

    // limit_side_len リサイズ: 長辺をLIMIT_SIDE_LENに制限し、32の倍数にパディング
    let resizeW = origW
    let resizeH = origH

    const ratio = LIMIT_SIDE_LEN / Math.max(resizeW, resizeH)
    if (ratio < 1) {
      resizeW = Math.round(resizeW * ratio)
      resizeH = Math.round(resizeH * ratio)
    }

    // 32の倍数に切り上げ
    resizeW = Math.ceil(resizeW / 32) * 32
    resizeH = Math.ceil(resizeH / 32) * 32

    // リサイズ
    const srcCanvas = new OffscreenCanvas(origW, origH)
    const srcCtx = srcCanvas.getContext('2d')!
    srcCtx.putImageData(imageData, 0, 0)

    const canvas = new OffscreenCanvas(resizeW, resizeH)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(srcCanvas, 0, 0, origW, origH, 0, 0, resizeW, resizeH)

    const resized = ctx.getImageData(0, 0, resizeW, resizeH)
    const { data } = resized

    // NCHW形式 + ImageNet正規化 (RGB→BGR変換)
    const tensorData = new Float32Array(3 * resizeH * resizeW)
    const mean = [0.485, 0.456, 0.406] // RGB
    const std = [0.229, 0.224, 0.225]   // RGB

    for (let h = 0; h < resizeH; h++) {
      for (let w = 0; w < resizeW; w++) {
        const pixelOffset = (h * resizeW + w) * 4
        const r = data[pixelOffset] / 255.0
        const g = data[pixelOffset + 1] / 255.0
        const b = data[pixelOffset + 2] / 255.0

        // RGB順序（PaddleOCRモデルの入力はRGB）
        tensorData[0 * resizeH * resizeW + h * resizeW + w] = (r - mean[0]) / std[0]
        tensorData[1 * resizeH * resizeW + h * resizeW + w] = (g - mean[1]) / std[1]
        tensorData[2 * resizeH * resizeW + h * resizeW + w] = (b - mean[2]) / std[2]
      }
    }

    const tensor = new ort.Tensor('float32', tensorData, [1, 3, resizeH, resizeW])

    return {
      tensor,
      metadata: {
        originalWidth: origW,
        originalHeight: origH,
        resizedWidth: resizeW,
        resizedHeight: resizeH,
        ratioW: origW / resizeW,
        ratioH: origH / resizeH,
      },
    }
  }

  private postprocessOutput(
    output: Record<string, OrtType.Tensor>,
    metadata: PreprocessResult['metadata']
  ): TextRegion[] {
    const outputName = this.session!.outputNames[0]
    const probMap = output[outputName].data as Float32Array
    const dims = output[outputName].dims
    const mapH = dims[2] as number
    const mapW = dims[3] as number

    // 1. 二値化
    const binaryMap = new Uint8Array(mapH * mapW)
    for (let i = 0; i < probMap.length; i++) {
      binaryMap[i] = probMap[i] > BINARY_THRESH ? 1 : 0
    }

    // 2. 連結成分抽出
    const contours = this.findContours(binaryMap, mapW, mapH)

    // 3. 各連結成分にminAreaRect + フィルタリング + unclip
    const regions: TextRegion[] = []

    for (const contour of contours) {
      if (contour.length < 4) continue

      // 確率マップ上の平均スコアを計算
      const score = this.calcBoxScore(probMap, contour, mapW)
      if (score < BOX_THRESH) continue

      // 輪郭のバウンディングボックス
      const rect = this.minBoundingRect(contour)
      if (rect.width < MIN_BOX_SIZE || rect.height < MIN_BOX_SIZE) continue

      // unclip: ボックスを拡張
      const expanded = this.unclip(rect, UNCLIP_RATIO)

      // 元画像座標に変換
      const x = Math.max(0, Math.round(expanded.x * metadata.ratioW))
      const y = Math.max(0, Math.round(expanded.y * metadata.ratioH))
      const w = Math.min(
        metadata.originalWidth - x,
        Math.round(expanded.width * metadata.ratioW)
      )
      const h = Math.min(
        metadata.originalHeight - y,
        Math.round(expanded.height * metadata.ratioH)
      )

      if (w >= 5 && h >= 5) {
        regions.push({ x, y, width: w, height: h, confidence: score })
      }
    }

    return regions
  }

  /**
   * 簡易findContours: 連結成分ラベリング→各成分の輪郭点抽出
   */
  private findContours(binary: Uint8Array, width: number, height: number): Array<Array<[number, number]>> {
    const labels = new Int32Array(width * height)
    let nextLabel = 1
    const equivalences = new Map<number, number>()

    const find = (x: number): number => {
      while (equivalences.has(x)) x = equivalences.get(x)!
      return x
    }
    const union = (a: number, b: number) => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) equivalences.set(Math.max(ra, rb), Math.min(ra, rb))
    }

    // First pass: ラベル割り当て
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        if (binary[idx] === 0) continue

        const neighbors: number[] = []
        if (y > 0 && labels[(y - 1) * width + x] > 0) neighbors.push(labels[(y - 1) * width + x])
        if (x > 0 && labels[y * width + (x - 1)] > 0) neighbors.push(labels[y * width + (x - 1)])
        if (y > 0 && x > 0 && labels[(y - 1) * width + (x - 1)] > 0) neighbors.push(labels[(y - 1) * width + (x - 1)])
        if (y > 0 && x < width - 1 && labels[(y - 1) * width + (x + 1)] > 0) neighbors.push(labels[(y - 1) * width + (x + 1)])

        if (neighbors.length === 0) {
          labels[idx] = nextLabel++
        } else {
          const minLabel = Math.min(...neighbors)
          labels[idx] = minLabel
          for (const n of neighbors) {
            if (n !== minLabel) union(n, minLabel)
          }
        }
      }
    }

    // Second pass: ラベル統一 & コンポーネント収集
    const components = new Map<number, { minX: number; minY: number; maxX: number; maxY: number; points: Array<[number, number]> }>()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        if (labels[idx] === 0) continue
        const root = find(labels[idx])
        labels[idx] = root

        if (!components.has(root)) {
          components.set(root, { minX: x, minY: y, maxX: x, maxY: y, points: [] })
        }
        const comp = components.get(root)!
        comp.minX = Math.min(comp.minX, x)
        comp.minY = Math.min(comp.minY, y)
        comp.maxX = Math.max(comp.maxX, x)
        comp.maxY = Math.max(comp.maxY, y)
        comp.points.push([x, y])
      }
    }

    // 各成分の境界点を輪郭として返す
    const contours: Array<Array<[number, number]>> = []
    for (const comp of components.values()) {
      if (comp.points.length < 10) continue
      const boundary: Array<[number, number]> = []
      for (const [x, y] of comp.points) {
        const idx = y * width + x
        const atEdge = x === 0 || x === width - 1 || y === 0 || y === height - 1
        if (
          atEdge ||
          (x > 0 && binary[idx - 1] === 0) ||
          (x < width - 1 && binary[idx + 1] === 0) ||
          (y > 0 && binary[idx - width] === 0) ||
          (y < height - 1 && binary[idx + width] === 0)
        ) {
          boundary.push([x, y])
        }
      }
      if (boundary.length >= 4) {
        contours.push(boundary)
      }
    }

    return contours
  }

  /**
   * 確率マップ上で輪郭内部の平均スコアを計算
   */
  private calcBoxScore(
    probMap: Float32Array,
    contour: Array<[number, number]>,
    mapW: number
  ): number {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of contour) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }

    let sum = 0
    let count = 0
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        sum += probMap[y * mapW + x]
        count++
      }
    }

    return count > 0 ? sum / count : 0
  }

  /**
   * 輪郭点群の最小外接矩形（axis-aligned）
   */
  private minBoundingRect(contour: Array<[number, number]>): { x: number; y: number; width: number; height: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of contour) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }

  /**
   * Unclip: Vatti clipping簡易版
   * 面積/周長の比率でボックスを拡張
   */
  private unclip(
    rect: { x: number; y: number; width: number; height: number },
    ratio: number
  ): { x: number; y: number; width: number; height: number } {
    const area = rect.width * rect.height
    const perimeter = 2 * (rect.width + rect.height)
    const distance = area * ratio / perimeter

    return {
      x: rect.x - distance,
      y: rect.y - distance,
      width: rect.width + 2 * distance,
      height: rect.height + 2 * distance,
    }
  }

  dispose(): void {
    if (this.session) {
      this.session.release()
      this.session = null
    }
    this.initialized = false
  }
}
