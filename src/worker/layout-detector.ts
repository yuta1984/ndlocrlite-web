/**
 * レイアウト検出モジュール（DEIMv2モデル）
 * 参照実装: ndlocr-lite/src/deim.py
 *
 * DEIMモデルの入出力:
 *   入力[0]: 画像テンソル [1, 3, H, W] (ImageNet正規化)
 *   入力[1]: im_shape [[H, W]] (int64)
 *   出力[0]: class_ids (1-indexed, int64)
 *   出力[1]: bboxes [N, 4] (x1,y1,x2,y2 in input pixel space)
 *   出力[2]: scores
 *   出力[3]: char_counts (int64: 1/2/3 のカテゴリ)
 */

import type * as OrtType from 'onnxruntime-web'
import { getOrt, createSession } from './onnx-config'
import type { TextRegion, PageBlock, LayoutDetectionResult, TableRegion } from '../types/ocr'
import { padSquareResizePIL, type RGBAImage } from './image-ops'

// ndl.yaml の line クラスID (0-indexed, class_index = label - 1)
const LINE_CLASS_IDS = new Set([1, 2, 3, 4, 5, 16]) // line_main, line_caption, line_ad, line_note, line_note_tochu, line_title
const BLOCK_CLASS_ID = 0 // text_block (段・カラム境界)
const TABLE_CLASS_ID = 15 // block_table (表組)

export interface LayoutDetectorOptions {
  /** 信頼度しきい値 */
  confThreshold: number
  /** ライン矩形の上下拡張率 */
  lineExpandRatio: number
  /** 同一クラスの重なり抑制（交差面積 / 小さい方の面積 >= この値なら小さい方を除去）。0 で無効 */
  overlapThreshold: number
  /** IoU ベースの NMS しきい値（0 で無効） */
  nmsIouThreshold: number
}

// 本家 v2 の既定値（det-conf-threshold 0.25, det-overlap-threshold 0.9）に合わせ、
// 本家と同じく行矩形は拡張せずに切り出す。重複行の除去（NMS）は本家の XML 構築処理
// （ndl_parser）での重複排除に相当するため残す
// （tests/integration で本家出力との一致率が最も高い組み合わせ: 文字F値 0.997）
export const DEFAULT_LAYOUT_OPTIONS: LayoutDetectorOptions = {
  confThreshold: 0.25,
  lineExpandRatio: 0,
  overlapThreshold: 0.9,
  nmsIouThreshold: 0.5,
}

interface PreprocessResult {
  tensor: OrtType.Tensor
  maxWH: number
  originalWidth: number
  originalHeight: number
}

export class LayoutDetector {
  private session: OrtType.InferenceSession | null = null
  // deim-s-1024x1024.onnx の実際の入力サイズ（ファイル名は 1024 だが実体は 800x800）
  private inputSize = { width: 800, height: 800 }
  private options: LayoutDetectorOptions

  constructor(options: Partial<LayoutDetectorOptions> = {}) {
    this.options = { ...DEFAULT_LAYOUT_OPTIONS, ...options }
  }

  async initialize(
    modelData: ArrayBuffer | Uint8Array,
    sessionOptions: Partial<OrtType.InferenceSession.SessionOptions> = {}
  ): Promise<void> {
    if (this.session) return
    this.session = await createSession(modelData, sessionOptions)
  }

  async detect(
    imageData: RGBAImage,
    onProgress?: (progress: number) => void
  ): Promise<LayoutDetectionResult> {
    if (!this.session) throw new Error('Layout detector not initialized')

    onProgress?.(0.1)
    const pre = this.preprocessImage(imageData)
    onProgress?.(0.5)

    // DEIMモデルは2入力: 画像テンソル + im_shape
    const inputNames = this.session.inputNames
    const inputs: Record<string, OrtType.Tensor> = { [inputNames[0]]: pre.tensor }
    if (inputNames.length > 1) {
      inputs[inputNames[1]] = new (getOrt().Tensor)(
        'int64',
        BigInt64Array.from([BigInt(this.inputSize.height), BigInt(this.inputSize.width)]),
        [1, 2]
      )
    }

    const output = await this.session.run(inputs)
    onProgress?.(0.8)
    const result = this.postprocessOutput(output, pre)
    onProgress?.(1.0)
    return result
  }

  private preprocessImage(imageData: RGBAImage): PreprocessResult {
    const { width: W, height: H } = this.inputSize
    // 本家 deim.py と同じ: 右下を黒でパディングして正方形化 → PIL bicubic でリサイズ
    const rgb = padSquareResizePIL(imageData, W)

    // NCHW形式 + ImageNet正規化
    const plane = W * H
    const tensorData = new Float32Array(3 * plane)
    const mean = [0.485, 0.456, 0.406]
    const std = [0.229, 0.224, 0.225]
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) {
        tensorData[c * plane + i] = (rgb[i * 3 + c] / 255 - mean[c]) / std[c]
      }
    }

    return {
      tensor: new (getOrt().Tensor)('float32', tensorData, [1, 3, H, W]),
      maxWH: Math.max(imageData.width, imageData.height),
      originalWidth: imageData.width,
      originalHeight: imageData.height,
    }
  }

  private postprocessOutput(
    output: Record<string, OrtType.Tensor>,
    pre: PreprocessResult
  ): LayoutDetectionResult {
    const { confThreshold, lineExpandRatio, overlapThreshold, nmsIouThreshold } = this.options
    const outputNames = this.session!.outputNames
    const classIdsRaw = output[outputNames[0]].data
    const bboxesData = output[outputNames[1]].data as Float32Array
    const scoresData = output[outputNames[2]].data as Float32Array
    // char_count は int64 (BigInt64Array) で出力されるため Number に変換して扱う
    const charCountsRaw = outputNames.length > 3 ? output[outputNames[3]].data : null

    // bboxes は [0, inputSize] 範囲 → [0, maxWH] に変換（deim.py と同じ）
    const scale = pre.maxWH / this.inputSize.width
    const W = pre.originalWidth
    const H = pre.originalHeight

    const lines: TextRegion[] = []
    const blocks: (PageBlock & { score: number })[] = []
    const tables: TableRegion[] = []

    for (let i = 0; i < scoresData.length; i++) {
      const score = scoresData[i]
      if (!(score > confThreshold)) continue

      const classId = Number(classIdsRaw[i]) - 1 // 1-indexed → 0-indexed
      // deim.py: (pred * scale).astype(int32) → clip
      const x1 = Math.min(Math.max(Math.trunc(bboxesData[i * 4] * scale), 0), W)
      const y1 = Math.min(Math.max(Math.trunc(bboxesData[i * 4 + 1] * scale), 0), H)
      const x2 = Math.min(Math.max(Math.trunc(bboxesData[i * 4 + 2] * scale), 0), W)
      const y2 = Math.min(Math.max(Math.trunc(bboxesData[i * 4 + 3] * scale), 0), H)

      if (classId === TABLE_CLASS_ID) {
        if (x2 - x1 > 0 && y2 - y1 > 0) tables.push({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, confidence: score })
      } else if (classId === BLOCK_CLASS_ID) {
        const width = x2 - x1
        const height = y2 - y1
        if (width >= 10 && height >= 10) blocks.push({ x: x1, y: y1, width, height, score })
      } else if (LINE_CLASS_IDS.has(classId)) {
        const deltaH = (y2 - y1) * lineExpandRatio
        const fy1 = Math.max(0, Math.round(y1 - deltaH))
        const fy2 = Math.min(H, Math.round(y2 + deltaH))
        const width = x2 - x1
        const height = fy2 - fy1
        if (width >= 10 && height >= 10) {
          const charCountCategory = charCountsRaw ? Number(charCountsRaw[i]) : 100
          lines.push({ x: x1, y: fy1, width, height, confidence: score, classId, charCountCategory })
        }
      }
    }

    let keptLines = lines
    let keptBlocks: PageBlock[] = blocks
    if (overlapThreshold > 0) {
      keptLines = suppressOverlapping(lines, overlapThreshold, (d) => d.classId)
      keptBlocks = suppressOverlapping(blocks, overlapThreshold, () => BLOCK_CLASS_ID)
    }
    if (nmsIouThreshold > 0) keptLines = nms(keptLines, nmsIouThreshold)

    return {
      lines: keptLines,
      blocks: keptBlocks.map(({ x, y, width, height }) => ({ x, y, width, height })),
      tables: overlapThreshold > 0 ? suppressOverlapping(tables, overlapThreshold, () => TABLE_CLASS_ID) : tables,
    }
  }

  dispose(): void {
    this.session?.release()
    this.session = null
  }
}

interface Box { x: number; y: number; width: number; height: number }

/**
 * deim.py _suppress_overlapping_regions と同じ:
 * 同一クラス内で、より大きい矩形に「交差面積 / 自身の面積 >= threshold」で含まれる矩形を除去
 */
export function suppressOverlapping<T extends Box>(dets: T[], threshold: number, classOf: (d: T) => number): T[] {
  const areas = dets.map((d) => Math.max(0, d.width) * Math.max(0, d.height))
  const order = dets.map((_, i) => i).sort((a, b) => areas[b] - areas[a])
  const keptByClass = new Map<number, number[]>()
  const suppressed = new Set<number>()
  for (const idx of order) {
    const area = areas[idx]
    if (area <= 0) continue
    const d = dets[idx]
    const cls = classOf(d)
    const kept = keptByClass.get(cls) ?? []
    let isSuppressed = false
    for (const other of kept) {
      if (areas[other] <= area) continue
      const o = dets[other]
      const ix = Math.max(0, Math.min(d.x + d.width, o.x + o.width) - Math.max(d.x, o.x))
      const iy = Math.max(0, Math.min(d.y + d.height, o.y + o.height) - Math.max(d.y, o.y))
      if ((ix * iy) / area >= threshold) {
        isSuppressed = true
        break
      }
    }
    if (isSuppressed) suppressed.add(idx)
    else {
      kept.push(idx)
      keptByClass.set(cls, kept)
    }
  }
  return dets.filter((_, i) => !suppressed.has(i))
}

function nms(detections: TextRegion[], iouThreshold: number): TextRegion[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence)
  const keep: TextRegion[] = []
  for (const d of sorted) {
    if (keep.every((k) => iou(k, d) < iouThreshold)) keep.push(d)
  }
  return keep
}

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const inter = ix * iy
  if (inter === 0) return 0
  return inter / (a.width * a.height + b.width * b.height - inter)
}
