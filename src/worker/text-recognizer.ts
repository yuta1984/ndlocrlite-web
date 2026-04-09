/**
 * 文字認識モジュール（PaddleOCR SVTR/CRNN モデル）
 *
 * 入力: [1, 3, 48, W] (高さ48固定, 幅可変, PaddleOCR正規化, RGB)  ※PP-OCRv5
 * 出力: [1, seq_len, vocab_size] CTC logits
 * デコード: CTC Greedy (argmax → 連続重複除去 → blank除去 → 辞書マッピング)
 */

import type * as OrtType from 'onnxruntime-web'
import { ort, createSession } from './onnx-config'
import type { TextRegion } from '../types/ocr'

const REC_IMAGE_HEIGHT = 48  // PP-OCRv5 は高さ48
const REC_IMAGE_WIDTH = 320  // デフォルト幅（リサイズ時に調整）
const WIDTH_DIVISOR = 8   // 幅は8の倍数

interface RecognitionResult {
  text: string
  confidence: number
}

export class TextRecognizer {
  private session: OrtType.InferenceSession | null = null
  private initialized = false
  private charList: string[] = []
  private dictPath: string

  constructor(dictPath: string = '/config/paddleocr/chinese_dict.txt') {
    this.dictPath = dictPath
  }

  async initialize(modelData: ArrayBuffer): Promise<void> {
    if (this.initialized) return

    try {
      await this.loadDict()
      this.session = await createSession(modelData)
      this.initialized = true
      console.log(`[TextRecognizer] initialized (dict: ${this.charList.length} chars)`)
    } catch (error) {
      console.error('Failed to initialize text recognizer:', error)
      throw error
    }
  }

  private async loadDict(): Promise<void> {
    try {
      const response = await fetch(this.dictPath)
      if (!response.ok) throw new Error(`Failed to load dict: ${response.statusText}`)

      const text = await response.text()
      // 辞書: 1行1文字。先頭にblank(index=0)を暗黙追加
      this.charList = text.split('\n').filter(line => line.length > 0)
      console.log(`[TextRecognizer] Dictionary loaded: ${this.charList.length} characters from ${this.dictPath}`)
    } catch (error) {
      console.warn(`Failed to load dictionary: ${(error as Error).message}`)
      this.charList = []
    }
  }

  async recognize(imageData: ImageData, region: TextRegion): Promise<RecognitionResult> {
    const cropped = TextRecognizer.cropImageData(imageData, region)
    return this.recognizeCropped(cropped)
  }

  async recognizeCropped(croppedImageData: ImageData): Promise<RecognitionResult> {
    if (!this.initialized || !this.session) {
      throw new Error('Text recognizer not initialized')
    }

    try {
      const inputTensor = this.preprocess(croppedImageData)
      const output = await this.session.run({
        [this.session.inputNames[0]]: inputTensor,
      })
      return this.decodeOutput(output)
    } catch (error) {
      console.error('Text recognition failed:', error)
      return { text: '', confidence: 0.0 }
    }
  }

  static cropImageData(imageData: ImageData, region: TextRegion): ImageData {
    const sourceCanvas = new OffscreenCanvas(imageData.width, imageData.height)
    const sourceCtx = sourceCanvas.getContext('2d')!
    sourceCtx.putImageData(imageData, 0, 0)

    const canvas = new OffscreenCanvas(region.width, region.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(sourceCanvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)

    return ctx.getImageData(0, 0, region.width, region.height)
  }

  /** 複数領域を一括クロップ。sourceCanvas を1度だけ生成して使い回す */
  static cropImageDataBatch(imageData: ImageData, regions: TextRegion[]): ImageData[] {
    const sourceCanvas = new OffscreenCanvas(imageData.width, imageData.height)
    const sourceCtx = sourceCanvas.getContext('2d')!
    sourceCtx.putImageData(imageData, 0, 0)

    return regions.map(region => {
      const canvas = new OffscreenCanvas(region.width, region.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(sourceCanvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
      return ctx.getImageData(0, 0, region.width, region.height)
    })
  }

  /**
   * PaddleOCR認識モデルの前処理:
   * 1. 縦長画像は90度回転
   * 2. 高さ48pxにリサイズ（アスペクト比維持、幅は8の倍数）
   * 3. ImageNet正規化 + BGR + NCHW
   */
  private preprocess(imageData: ImageData): OrtType.Tensor {
    const imgWidth = imageData.width
    const imgHeight = imageData.height

    // 縦長画像は90度回転（反時計回り）
    const rotCanvas = new OffscreenCanvas(1, 1)
    const rotCtx = rotCanvas.getContext('2d')!

    let srcW: number, srcH: number
    if (imgHeight > imgWidth * 1.5) {
      srcW = imgHeight
      srcH = imgWidth
      rotCanvas.width = srcW
      rotCanvas.height = srcH
      rotCtx.translate(srcW / 2, srcH / 2)
      rotCtx.rotate(-Math.PI / 2)
      rotCtx.translate(-srcH / 2, -srcW / 2)
    } else {
      srcW = imgWidth
      srcH = imgHeight
      rotCanvas.width = srcW
      rotCanvas.height = srcH
    }

    const tempCanvas = new OffscreenCanvas(imgWidth, imgHeight)
    const tempCtx = tempCanvas.getContext('2d')!
    tempCtx.putImageData(imageData, 0, 0)
    rotCtx.drawImage(tempCanvas, 0, 0)

    // 高さ32pxにリサイズ（アスペクト比維持）
    const targetH = REC_IMAGE_HEIGHT
    const aspect = srcW / srcH
    let targetW = Math.round(targetH * aspect)
    // 幅を8の倍数に丸め、最低WIDTH_DIVISOR
    targetW = Math.max(WIDTH_DIVISOR, Math.ceil(targetW / WIDTH_DIVISOR) * WIDTH_DIVISOR)
    // 上限
    targetW = Math.min(targetW, REC_IMAGE_WIDTH * 2)

    const resizeCanvas = new OffscreenCanvas(targetW, targetH)
    const resizeCtx = resizeCanvas.getContext('2d')!
    resizeCtx.drawImage(rotCanvas, 0, 0, srcW, srcH, 0, 0, targetW, targetH)

    const resized = resizeCtx.getImageData(0, 0, targetW, targetH)
    const { data } = resized

    // NCHW形式 + PaddleOCR正規化 (RGB): (pixel/255 - 0.5) / 0.5
    const tensorData = new Float32Array(3 * targetH * targetW)
    const mean = [0.5, 0.5, 0.5] // PaddleOCR standard
    const std = [0.5, 0.5, 0.5]   // PaddleOCR standard

    for (let h = 0; h < targetH; h++) {
      for (let w = 0; w < targetW; w++) {
        const pixelOffset = (h * targetW + w) * 4
        const r = data[pixelOffset] / 255.0
        const g = data[pixelOffset + 1] / 255.0
        const b = data[pixelOffset + 2] / 255.0

        // RGB順序
        tensorData[0 * targetH * targetW + h * targetW + w] = (r - mean[0]) / std[0]
        tensorData[1 * targetH * targetW + h * targetW + w] = (g - mean[1]) / std[1]
        tensorData[2 * targetH * targetW + h * targetW + w] = (b - mean[2]) / std[2]
      }
    }

    return new ort.Tensor('float32', tensorData, [1, 3, targetH, targetW])
  }

  /**
   * CTC Greedy Decode:
   * 1. 各タイムステップでargmax
   * 2. 連続する同一文字を除去
   * 3. blank(index=0)を除去
   * 4. 辞書でマッピング
   */
  private decodeOutput(outputs: Record<string, OrtType.Tensor>): RecognitionResult {
    try {
      const outputName = this.session!.outputNames[0]
      const logits = outputs[outputName].data as Float32Array
      const dims = outputs[outputName].dims
      const seqLength = dims[1] as number
      const vocabSize = dims[2] as number

      const indices: number[] = []
      const confidences: number[] = []

      for (let t = 0; t < seqLength; t++) {
        const offset = t * vocabSize
        let maxIdx = 0
        let maxVal = logits[offset]

        for (let v = 1; v < vocabSize; v++) {
          if (logits[offset + v] > maxVal) {
            maxVal = logits[offset + v]
            maxIdx = v
          }
        }

        indices.push(maxIdx)
        // softmaxの近似として生のlogitを使う（速度重視）
        confidences.push(maxVal)
      }

      // CTC decode: 連続重複除去 + blank(0)除去
      const decodedChars: string[] = []
      const decodedConfidences: number[] = []
      let prevIdx = -1

      for (let t = 0; t < indices.length; t++) {
        const idx = indices[t]
        if (idx !== prevIdx && idx !== 0) {
          // 辞書のインデックスは1-based: idx=1 → charList[0]
          const charIdx = idx - 1
          if (charIdx >= 0 && charIdx < this.charList.length) {
            decodedChars.push(this.charList[charIdx])
            decodedConfidences.push(confidences[t])
          }
        }
        prevIdx = idx
      }

      const text = decodedChars.join('')
      const avgConfidence = decodedConfidences.length > 0
        ? decodedConfidences.reduce((a, b) => a + b, 0) / decodedConfidences.length
        : 0

      return { text, confidence: avgConfidence }
    } catch (error) {
      console.error('CTC decode error:', error)
      return { text: '', confidence: 0 }
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
