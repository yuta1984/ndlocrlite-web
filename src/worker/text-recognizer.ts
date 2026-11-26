/**
 * 文字認識モジュール（PARSeqモデル）
 * 参照実装: ndlocr-lite/src/parseq.py
 */

import * as yaml from 'js-yaml'
import type * as OrtType from 'onnxruntime-web'
import { getOrt, createSession } from './onnx-config'
import type { TextRegion } from '../types/ocr'
import { cropRGBA, rotate90CCW, resizeBilinearRGB, type RGBAImage } from './image-ops'
import { argmaxDecode, idsToText, parseCharset, removeAsciiSpacesAroundJapanesePunctuation } from './parseq-decode'

export interface RecognitionResult {
  text: string
  confidence: number
}

/** 縦長判定の閾値（h > w * VERTICAL_RATIO なら 90 度回転。本家 v2 で 1.0 → 0.8） */
export const VERTICAL_RATIO = 0.8

const CHARSET_URL = '/config/NDLmoji.yaml'
let charListPromise: Promise<string[]> | null = null

/** NDLmoji.yaml から文字リストを取得（Worker 内で 1 回だけ fetch） */
export function loadCharList(url = CHARSET_URL): Promise<string[]> {
  if (!charListPromise) {
    charListPromise = (async () => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Failed to load charset: ${response.statusText}`)
      return charListFromYaml(await response.text())
    })()
    charListPromise.catch(() => { charListPromise = null })
  }
  return charListPromise
}

export function charListFromYaml(yamlText: string): string[] {
  const cfg = yaml.load(yamlText) as { model?: { charset_train?: string } }
  const charset = cfg?.model?.charset_train
  if (!charset) throw new Error('charset_train not found in NDLmoji.yaml')
  return parseCharset(charset)
}

export class TextRecognizer {
  private session: OrtType.InferenceSession | null = null
  private charList: string[] = []
  readonly inputShape: [number, number, number, number]

  constructor(inputShape: [number, number, number, number]) {
    this.inputShape = inputShape
  }

  async initialize(modelData: ArrayBuffer | Uint8Array, charList?: string[]): Promise<void> {
    if (this.session) return
    this.charList = charList ?? (await loadCharList())
    this.session = await createSession(modelData)
    const dims = (this.session.inputMetadata?.[0] as { shape?: unknown[] } | undefined)?.shape
    if (dims && dims.length === 4) {
      const [, , h, w] = dims
      if (typeof h === 'number' && typeof w === 'number' && (h !== this.inputShape[2] || w !== this.inputShape[3])) {
        throw new Error(`Recognizer input shape mismatch: model ${h}x${w}, config ${this.inputShape[2]}x${this.inputShape[3]}`)
      }
    }
  }

  async recognize(imageData: RGBAImage, region: TextRegion): Promise<RecognitionResult> {
    return this.recognizeCropped(cropRGBA(imageData, region.x, region.y, region.width, region.height))
  }

  async recognizeCropped(image: RGBAImage): Promise<RecognitionResult> {
    if (!this.session) throw new Error('Text recognizer not initialized')
    if (image.width === 0 || image.height === 0) return { text: '', confidence: 0 }

    const inputTensor = this.preprocess(image)
    const output = await this.session.run({ [this.session.inputNames[0]]: inputTensor })
    const out = output[this.session.outputNames[0]]
    const [, seqLength, vocabSize] = out.dims
    const ids = argmaxDecode(out.data as Float32Array, seqLength, vocabSize)
    return { text: removeAsciiSpacesAroundJapanesePunctuation(idsToText(ids, this.charList)), confidence: 0.9 }
  }

  /** 本家 parseq.py preprocess と同じ: 縦長なら反時計回り回転 → INTER_LINEAR リサイズ → BGR → [-1, 1] */
  preprocess(image: RGBAImage): OrtType.Tensor {
    const [, , height, width] = this.inputShape
    const src = image.height > image.width * VERTICAL_RATIO ? rotate90CCW(image) : image
    const resized = resizeBilinearRGB(src, width, height)

    const plane = height * width
    const tensorData = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) {
      const r = resized[i * 3]
      const g = resized[i * 3 + 1]
      const b = resized[i * 3 + 2]
      // 本家は RGB 画像に [:, :, ::-1] を適用して BGR 順で入力している
      tensorData[i] = b / 127.5 - 1.0
      tensorData[plane + i] = g / 127.5 - 1.0
      tensorData[2 * plane + i] = r / 127.5 - 1.0
    }
    return new (getOrt().Tensor)('float32', tensorData, this.inputShape)
  }

  dispose(): void {
    this.session?.release()
    this.session = null
  }
}
