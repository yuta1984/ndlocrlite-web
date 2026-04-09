/**
 * テスト用ヘルパー: Node.js 環境で ONNX モデルを操作
 *
 * ブラウザ用の onnx-config.ts / model-loader.ts を迂回し、
 * onnxruntime-node + ファイルシステムを直接使う
 */

import * as ort from 'onnxruntime-node'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { MODEL_URLS } from '../src/worker/model-loader'

// モデルキャッシュディレクトリ
const MODEL_CACHE_DIR = join(__dirname, '.model-cache')

/**
 * モデルをダウンロード（キャッシュあり）
 */
export async function downloadModel(modelKey: string): Promise<ArrayBuffer> {
  mkdirSync(MODEL_CACHE_DIR, { recursive: true })
  const cachePath = join(MODEL_CACHE_DIR, `${modelKey}.onnx`)

  if (existsSync(cachePath)) {
    console.log(`  [cache hit] ${modelKey}`)
    const buf = readFileSync(cachePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }

  const url = MODEL_URLS[modelKey]
  if (!url) throw new Error(`Unknown model key: ${modelKey}`)

  console.log(`  [downloading] ${modelKey} from ${url}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)

  const arrayBuffer = await response.arrayBuffer()
  writeFileSync(cachePath, Buffer.from(arrayBuffer))
  console.log(`  [cached] ${modelKey} (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB)`)
  return arrayBuffer
}

/**
 * ONNX セッションを作成
 */
export async function createTestSession(modelData: ArrayBuffer): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(Buffer.from(modelData), {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'basic',
  })
}

/**
 * PNG ファイルを ImageData-like オブジェクトに変換
 */
export async function loadPngAsImageData(pngPath: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const png = readFileSync(pngPath)
  const img = await loadImage(png)

  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d') as SKRSContext2D
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, img.width, img.height)
  return {
    data: new Uint8ClampedArray(imageData.data),
    width: img.width,
    height: img.height,
  }
}

/**
 * 検出モデルの前処理（layout-detector.ts の preprocess と同等ロジック）
 */
export function preprocessForDetection(
  imageData: { data: Uint8ClampedArray; width: number; height: number }
): { tensor: ort.Tensor; metadata: { originalWidth: number; originalHeight: number; resizedWidth: number; resizedHeight: number; ratioW: number; ratioH: number } } {
  const origW = imageData.width
  const origH = imageData.height

  // limit_side_len = 960
  const LIMIT_SIDE_LEN = 960
  let resizeW = origW
  let resizeH = origH

  const ratio = Math.min(LIMIT_SIDE_LEN / Math.max(origW, origH), 1.0)
  if (ratio < 1.0) {
    resizeW = Math.round(origW * ratio)
    resizeH = Math.round(origH * ratio)
  }

  // 32の倍数に丸め
  resizeW = Math.max(32, Math.ceil(resizeW / 32) * 32)
  resizeH = Math.max(32, Math.ceil(resizeH / 32) * 32)

  // ImageData を Canvas に直接描画してリサイズ
  const srcCanvas = createCanvas(origW, origH)
  const srcCtx = srcCanvas.getContext('2d') as SKRSContext2D
  const imgDataObj = srcCtx.createImageData(origW, origH)
  imgDataObj.data.set(imageData.data)
  srcCtx.putImageData(imgDataObj, 0, 0)

  const resizeCanvas = createCanvas(resizeW, resizeH)
  const resizeCtx = resizeCanvas.getContext('2d') as SKRSContext2D
  resizeCtx.drawImage(srcCanvas, 0, 0, origW, origH, 0, 0, resizeW, resizeH)

  const resized = resizeCtx.getImageData(0, 0, resizeW, resizeH)
  const { data } = resized

  // NCHW + ImageNet normalization (RGB)
  const tensorData = new Float32Array(3 * resizeH * resizeW)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]

  for (let h = 0; h < resizeH; h++) {
    for (let w = 0; w < resizeW; w++) {
      const pixelOffset = (h * resizeW + w) * 4
      const r = data[pixelOffset] / 255.0
      const g = data[pixelOffset + 1] / 255.0
      const b = data[pixelOffset + 2] / 255.0

      // RGB順序
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

/**
 * 認識モデルの前処理（text-recognizer.ts の preprocess と同等ロジック）
 */
export function preprocessForRecognition(
  imageData: { data: Uint8ClampedArray; width: number; height: number }
): ort.Tensor {
  const REC_IMAGE_HEIGHT = 48
  const WIDTH_DIVISOR = 8
  const MAX_WIDTH = 640

  const imgW = imageData.width
  const imgH = imageData.height

  let srcW = imgW
  let srcH = imgH

  // 縦長画像は回転（ここでは省略 — テスト画像は横長）
  const targetH = REC_IMAGE_HEIGHT
  const aspect = srcW / srcH
  let targetW = Math.round(targetH * aspect)
  targetW = Math.max(WIDTH_DIVISOR, Math.ceil(targetW / WIDTH_DIVISOR) * WIDTH_DIVISOR)
  targetW = Math.min(targetW, MAX_WIDTH)

  // Canvas でリサイズ
  const srcCanvas = createCanvas(imgW, imgH)
  const srcCtx = srcCanvas.getContext('2d') as SKRSContext2D
  const imgDataObj = srcCtx.createImageData(imgW, imgH)
  imgDataObj.data.set(imageData.data)
  srcCtx.putImageData(imgDataObj, 0, 0)

  const resizeCanvas = createCanvas(targetW, targetH)
  const resizeCtx = resizeCanvas.getContext('2d') as SKRSContext2D
  resizeCtx.drawImage(srcCanvas, 0, 0, srcW, srcH, 0, 0, targetW, targetH)

  const resized = resizeCtx.getImageData(0, 0, targetW, targetH)
  const { data } = resized

  // PaddleOCR正規化: (pixel/255 - 0.5) / 0.5
  const tensorData = new Float32Array(3 * targetH * targetW)
  const mean = [0.5, 0.5, 0.5]
  const std = [0.5, 0.5, 0.5]

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
 * DB後処理: 確率マップ → bounding boxes
 */
export function dbPostprocess(
  probMap: Float32Array,
  mapW: number,
  mapH: number,
  ratioW: number,
  ratioH: number,
  threshold = 0.3,
  boxThresh = 0.6,
): Array<{ x: number; y: number; width: number; height: number; score: number }> {
  // 二値化
  const binary = new Uint8Array(mapW * mapH)
  for (let i = 0; i < probMap.length; i++) {
    binary[i] = probMap[i] > threshold ? 1 : 0
  }

  // 連結成分ラベリング (簡易版)
  const labels = new Int32Array(mapW * mapH)
  let nextLabel = 1
  const equivalences = new Map<number, number>()

  const findRoot = (label: number): number => {
    let root = label
    while (equivalences.has(root)) root = equivalences.get(root)!
    return root
  }

  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const idx = y * mapW + x
      if (binary[idx] === 0) continue

      const neighbors: number[] = []
      if (y > 0 && labels[(y - 1) * mapW + x] > 0) neighbors.push(labels[(y - 1) * mapW + x])
      if (x > 0 && labels[y * mapW + (x - 1)] > 0) neighbors.push(labels[y * mapW + (x - 1)])
      if (y > 0 && x > 0 && labels[(y - 1) * mapW + (x - 1)] > 0) neighbors.push(labels[(y - 1) * mapW + (x - 1)])
      if (y > 0 && x < mapW - 1 && labels[(y - 1) * mapW + (x + 1)] > 0) neighbors.push(labels[(y - 1) * mapW + (x + 1)])

      if (neighbors.length === 0) {
        labels[idx] = nextLabel++
      } else {
        const roots = [...new Set(neighbors.map(findRoot))]
        const minRoot = Math.min(...roots)
        labels[idx] = minRoot
        for (const r of roots) {
          if (r !== minRoot) equivalences.set(r, minRoot)
        }
      }
    }
  }

  // 成分ごとの bounding box
  const components = new Map<number, { minX: number; minY: number; maxX: number; maxY: number; count: number; scoreSum: number }>()
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const idx = y * mapW + x
      if (labels[idx] === 0) continue
      const root = findRoot(labels[idx])
      labels[idx] = root

      if (!components.has(root)) {
        components.set(root, { minX: x, minY: y, maxX: x, maxY: y, count: 0, scoreSum: 0 })
      }
      const c = components.get(root)!
      c.minX = Math.min(c.minX, x)
      c.minY = Math.min(c.minY, y)
      c.maxX = Math.max(c.maxX, x)
      c.maxY = Math.max(c.maxY, y)
      c.count++
      c.scoreSum += probMap[idx]
    }
  }

  const results: Array<{ x: number; y: number; width: number; height: number; score: number }> = []
  for (const c of components.values()) {
    if (c.count < 10) continue
    const avgScore = c.scoreSum / c.count
    if (avgScore < boxThresh) continue

    // unclip
    const w = c.maxX - c.minX
    const h = c.maxY - c.minY
    const area = w * h
    const perimeter = 2 * (w + h)
    const distance = perimeter > 0 ? area * 1.5 / perimeter : 0

    results.push({
      x: Math.max(0, (c.minX - distance) * ratioW),
      y: Math.max(0, (c.minY - distance) * ratioH),
      width: (w + 2 * distance) * ratioW,
      height: (h + 2 * distance) * ratioH,
      score: avgScore,
    })
  }

  return results
}

/**
 * CTC Greedy Decode
 */
export function ctcDecode(logits: Float32Array, seqLength: number, vocabSize: number, charList: string[]): string {
  const indices: number[] = []

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
  }

  // 連続重複除去 + blank(0) 除去
  const chars: string[] = []
  let prevIdx = -1
  for (const idx of indices) {
    if (idx !== prevIdx && idx !== 0) {
      const charIdx = idx - 1
      if (charIdx >= 0 && charIdx < charList.length) {
        chars.push(charList[charIdx])
      }
    }
    prevIdx = idx
  }

  return chars.join('')
}

/**
 * 辞書ファイルを読み込み
 */
export function loadDict(dictPath: string): string[] {
  const text = readFileSync(dictPath, 'utf-8')
  return text.split('\n').filter(line => line.length > 0)
}

export { ort }
