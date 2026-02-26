/**
 * レイアウト検出モジュール（DEIMv2モデル）
 * 参照実装: ndlocr-lite/src/deim.py
 *
 * DEIMモデルの入出力:
 *   入力[0]: 画像テンソル [1, 3, H, W] (ImageNet正規化)
 *   入力[1]: im_shape [[H, W]] (int64)
 *   出力[0]: class_ids (1-indexed)
 *   出力[1]: bboxes [N, 4] (x1,y1,x2,y2 in input pixel space)
 *   出力[2]: scores
 *   出力[3]: char_counts (1.0/2.0/3.0 のカテゴリ、省略時は100.0)
 */

import type * as OrtType from 'onnxruntime-web'
import { ort, createSession } from './onnx-config'
import type { TextRegion } from '../types/ocr'

// ndl.yaml の line クラスID (0-indexed, class_index = label - 1)
const LINE_CLASS_IDS = new Set([1, 2, 3, 4, 5, 16]) // line_main, line_caption, line_ad, line_note, line_note_tochu, line_title

interface PreprocessResult {
  tensor: OrtType.Tensor
  metadata: {
    originalWidth: number
    originalHeight: number
    maxWH: number
    inputWidth: number
    inputHeight: number
  }
}

export class LayoutDetector {
  private session: OrtType.InferenceSession | null = null
  // deim-s-1024x1024.onnx の実際の入力サイズ（ファイル名は 1024 だが実体は 800x800）
  private inputSize = { width: 800, height: 800 }
  private initialized = false

  async initialize(modelData: ArrayBuffer): Promise<void> {
    if (this.initialized) return

    try {
      this.session = await createSession(modelData)
      this.initialized = true
      console.log(`Layout detector initialized: input ${this.inputSize.width}×${this.inputSize.height}`)
    } catch (error) {
      console.error('Failed to initialize layout detector:', error)
      throw error
    }
  }

  async detect(
    imageData: ImageData,
    onProgress?: (progress: number) => void
  ): Promise<TextRegion[]> {
    if (!this.initialized || !this.session) {
      throw new Error('Layout detector not initialized')
    }

    if (onProgress) onProgress(0.1)
    const { tensor, metadata } = await this.preprocessImage(imageData)

    if (onProgress) onProgress(0.5)

    // DEIMモデルは2入力: 画像テンソル + im_shape
    const inputNames = this.session.inputNames
    const inputs: Record<string, OrtType.Tensor> = {
      [inputNames[0]]: tensor,
    }
    if (inputNames.length > 1) {
      inputs[inputNames[1]] = new ort.Tensor(
        'int64',
        BigInt64Array.from([BigInt(this.inputSize.height), BigInt(this.inputSize.width)]),
        [1, 2]
      )
    }

    const output = await this.session.run(inputs)

    if (onProgress) onProgress(0.8)
    const detections = this.postprocessOutput(output, metadata)

    if (onProgress) onProgress(1.0)
    console.log(`[LayoutDetector] ${detections.length} line regions detected`)
    return detections
  }

  private async preprocessImage(imageData: ImageData): Promise<PreprocessResult> {
    return new Promise((resolve, reject) => {
      try {
        const originalSize = { width: imageData.width, height: imageData.height }
        const maxWH = Math.max(originalSize.width, originalSize.height)

        // 元画像をOffscreenCanvasに描画
        const imageCanvas = new OffscreenCanvas(imageData.width, imageData.height)
        const imageCtx = imageCanvas.getContext('2d')!
        imageCtx.putImageData(imageData, 0, 0)

        // 正方形パディング（左上に配置、黒背景）
        const paddingCanvas = new OffscreenCanvas(maxWH, maxWH)
        const paddingCtx = paddingCanvas.getContext('2d')!
        paddingCtx.fillStyle = 'rgb(0, 0, 0)'
        paddingCtx.fillRect(0, 0, maxWH, maxWH)
        paddingCtx.drawImage(imageCanvas, 0, 0)

        // モデル入力サイズにリサイズ
        const canvas = new OffscreenCanvas(this.inputSize.width, this.inputSize.height)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(paddingCanvas, 0, 0, maxWH, maxWH, 0, 0, this.inputSize.width, this.inputSize.height)

        const resizedImageData = ctx.getImageData(0, 0, this.inputSize.width, this.inputSize.height)
        const { data } = resizedImageData

        // NCHW形式 + ImageNet正規化
        const tensorData = new Float32Array(1 * 3 * this.inputSize.height * this.inputSize.width)
        const mean = [123.675, 116.28, 103.53]
        const std = [58.395, 57.12, 57.375]

        for (let h = 0; h < this.inputSize.height; h++) {
          for (let w = 0; w < this.inputSize.width; w++) {
            const pixelOffset = (h * this.inputSize.width + w) * 4
            for (let c = 0; c < 3; c++) {
              const tensorIdx =
                c * this.inputSize.height * this.inputSize.width +
                h * this.inputSize.width +
                w
              tensorData[tensorIdx] = (data[pixelOffset + c] - mean[c]) / std[c]
            }
          }
        }

        const inputTensor = new ort.Tensor('float32', tensorData, [
          1,
          3,
          this.inputSize.height,
          this.inputSize.width,
        ])

        resolve({
          tensor: inputTensor,
          metadata: {
            originalWidth: originalSize.width,
            originalHeight: originalSize.height,
            maxWH,
            inputWidth: this.inputSize.width,
            inputHeight: this.inputSize.height,
          },
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  private postprocessOutput(
    output: Record<string, OrtType.Tensor>,
    metadata: PreprocessResult['metadata']
  ): TextRegion[] {
    const detections: TextRegion[] = []

    try {
      const outputNames = this.session!.outputNames

      // DEIMモデルは4出力: class_ids, bboxes, scores, char_counts
      const classIdsRaw = output[outputNames[0]].data
      const bboxesData = output[outputNames[1]].data as Float32Array
      const scoresData = output[outputNames[2]].data as Float32Array
      const charCountsData = outputNames.length > 3
        ? (output[outputNames[3]].data as Float32Array)
        : null

      const numDetections = scoresData.length

      // deim.py と同じスケール計算:
      // bboxes は [0, inputSize] 範囲 → [0, maxWH] に変換
      const scaleX = metadata.maxWH / this.inputSize.width
      const scaleY = metadata.maxWH / this.inputSize.height

      const confThreshold = 0.3

      for (let i = 0; i < numDetections; i++) {
        const score = scoresData[i]
        if (score < confThreshold) continue

        // class_ids は 1-indexed → 0-indexed に変換
        const classId = Number(classIdsRaw[i]) - 1

        // ラインクラスのみ処理
        if (!LINE_CLASS_IDS.has(classId)) continue

        const x1 = bboxesData[i * 4 + 0] * scaleX
        const y1 = bboxesData[i * 4 + 1] * scaleY
        const x2 = bboxesData[i * 4 + 2] * scaleX
        const y2 = bboxesData[i * 4 + 3] * scaleY

        // バウンディングボックスを上下2%拡張
        const boxHeight = y2 - y1
        const deltaH = boxHeight * 0.02

        const finalX1 = Math.max(0, Math.round(x1))
        const finalY1 = Math.max(0, Math.round(y1 - deltaH))
        const finalX2 = Math.min(metadata.originalWidth, Math.round(x2))
        const finalY2 = Math.min(metadata.originalHeight, Math.round(y2 + deltaH))

        const width = finalX2 - finalX1
        const height = finalY2 - finalY1

        if (width < 10 || height < 10) continue

        const charCountCategory = charCountsData ? charCountsData[i] : 100

        detections.push({
          x: finalX1,
          y: finalY1,
          width,
          height,
          confidence: score,
          classId,
          charCountCategory,
        })
      }

      return this.nms(detections)
    } catch (error) {
      console.error('Error in postprocessing:', error)
      return []
    }
  }

  private nms(detections: TextRegion[], iouThreshold = 0.5): TextRegion[] {
    const sorted = [...detections].sort((a, b) => b.confidence - a.confidence)
    const keep: TextRegion[] = []
    for (const d of sorted) {
      if (keep.every((k) => this.iou(k, d) < iouThreshold)) keep.push(d)
    }
    return keep
  }

  private iou(a: TextRegion, b: TextRegion): number {
    const ax2 = a.x + a.width, ay2 = a.y + a.height
    const bx2 = b.x + b.width, by2 = b.y + b.height
    const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x))
    const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y))
    const inter = ix * iy
    if (inter === 0) return 0
    return inter / (a.width * a.height + b.width * b.height - inter)
  }

  dispose(): void {
    if (this.session) {
      this.session.release()
      this.session = null
    }
    this.initialized = false
  }
}
