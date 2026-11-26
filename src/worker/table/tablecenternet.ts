/**
 * 表構造認識（TableCenterNet-S）
 * 参照実装: ndlocr-lite v2.0.0 src/tablecenternet.py, src/optional_features/table_structure.py
 *
 * 流れ（本家 infer_tables_from_page と同じ）:
 *   1. レイアウト検出の表領域（block_table）を重なりでまとめ、余白（min 8px / 2%）をつけて切り出す
 *   2. TableCenterNet で切り出し画像のセル四角形と論理座標を推定（decode_official）
 *   3. 罫線が完全に取れる表は罫線格子でセルを置き換える（_ruled_table_cells）
 *   4. OCR 済みの行を論理グリッド経由でセルへ割り当て、欠けたセルを補完
 *   5. HTML（rowspan/colspan）と Markdown を生成
 */

import type * as OrtType from 'onnxruntime-web'
import { getOrt, createSession } from '../onnx-config'
import { cropRGBA, type RGBAImage } from '../image-ops'
import { getCenterAffine, warpAffineLinearBGR, roundHalfEven, type Point } from './cv-ops'
import {
  decodeOfficial, postprocess, DEFAULT_CENTER_THRESH, DEFAULT_CORNER_THRESH,
  type FeatureMap, type ModelOutputs,
} from './decode'
import {
  ruledTableCells, assignOcrLinesToCells, cellsToHtml, cellsToMarkdown, cellText, escapeHtml, tableGridShape,
  type WorkCell, type OcrLine, type BBox,
} from './structure'

export { tableGridShape } from './structure'

// 本家の正規化定数（BGR 順）
const f32 = Math.fround
const MEAN = [0.40789654, 0.44719302, 0.47026115].map(f32)
const STD = [0.28863828, 0.27408164, 0.27809835].map(f32)
const REQUIRED_OUTPUTS = ['hm', 'reg', 'ct2cn', 'cn2ct', 'lc', 'sp'] as const
export const DEFAULT_CROP_PADDING = 8

export interface TableRegionInput { x: number; y: number; width: number; height: number; confidence: number }
export interface TableLineInput { x: number; y: number; width: number; height: number; text: string }

export interface TableCell {
  /** 4 角（TL, TR, BR, BL）。recognize() ではクロップ座標、inferTablesFromPage() ではページ座標 */
  corners: [number, number][]
  /** 0 始まりの開始行・列 */
  row: number
  col: number
  rowSpan: number
  colSpan: number
  /** 割り当てられた OCR テキスト（複数行は '<br>' 区切り。本家 Markdown と同じ） */
  text?: string
  /** OCR があるのに検出されなかったスロットを補完したセル */
  synthetic?: boolean
  /** 信頼度（罫線由来・補完セルは 0） */
  score: number
  /** 0 始まり [startCol, endCol, startRow, endRow]（本家 logic_axis_0based） */
  logic: [number, number, number, number]
  /** 'ruling_lines' のとき罫線から復元したセル */
  structureSource?: 'ruling_lines'
}

export interface TableResult {
  /** 1 始まり */
  tableIndex: number
  layoutBbox: [number, number, number, number]
  cropBbox: [number, number, number, number]
  layoutConfidence: number
  sourceTableIndexes: number[]
  cells: TableCell[]
  /** 行数・列数（結合セルを含む論理グリッド） */
  rows: number
  cols: number
  /** 'ruling_lines' または 'model' */
  structureSource: 'ruling_lines' | 'model'
  detectedCellCount: number
  recoveredCellCount: number
  html: string
  markdown: string
  error?: string
}

export interface TableOptions { centerThresh?: number; cornerThresh?: number; cropPadding?: number }

function toTableCell(c: WorkCell, withText: boolean): TableCell {
  const [c1, c2, r1, r2] = c.logic
  const out: TableCell = {
    corners: c.corners.map(([x, y]) => [x, y] as [number, number]),
    row: r1,
    col: c1,
    rowSpan: r2 - r1 + 1,
    colSpan: c2 - c1 + 1,
    score: c.score,
    logic: [c1, c2, r1, r2],
  }
  if (withText) out.text = cellText(c)
  if (c.synthetic) out.synthetic = true
  if (c.structureSource) out.structureSource = c.structureSource
  return out
}

function fromTableCell(c: TableCell): WorkCell {
  return { score: c.score, corners: c.corners.map(([x, y]) => [x, y] as Point), logic: [...c.logic] as [number, number, number, number] }
}

export class TableStructureRecognizer {
  private session: OrtType.InferenceSession | null = null
  private inputName = 'image'
  private inputH = 800
  private inputW = 800
  private centerThresh: number
  private cornerThresh: number

  constructor(options: { centerThresh?: number; cornerThresh?: number } = {}) {
    this.centerThresh = options.centerThresh ?? DEFAULT_CENTER_THRESH
    this.cornerThresh = options.cornerThresh ?? DEFAULT_CORNER_THRESH
  }

  get initialized(): boolean {
    return this.session !== null
  }

  async initialize(
    modelData: ArrayBuffer | Uint8Array,
    sessionOptions?: Partial<OrtType.InferenceSession.SessionOptions>
  ): Promise<void> {
    this.session = await createSession(modelData, sessionOptions)
    this.inputName = this.session.inputNames[0]
    // 入力サイズは固定（tablecenternet_s_800_v3: 800x800）。メタデータが取れれば使う
    const meta = (this.session as { inputMetadata?: readonly { isTensor?: boolean; shape?: readonly (number | string)[] }[] }).inputMetadata?.[0]
    const shape = meta && meta.isTensor ? meta.shape : undefined
    if (shape && shape.length === 4 && typeof shape[2] === 'number' && typeof shape[3] === 'number') {
      this.inputH = shape[2]
      this.inputW = shape[3]
    }
    const missing = REQUIRED_OUTPUTS.filter((n) => !this.session!.outputNames.includes(n))
    if (missing.length) throw new Error(`Missing required ONNX outputs: ${missing.join(', ')}`)
  }

  /** 本家 recognize_rgb: クロップ画像のセル（クロップ座標）を返す */
  async recognize(image: RGBAImage, options: { centerThresh?: number; cornerThresh?: number } = {}): Promise<TableCell[]> {
    if (!this.session) throw new Error('TableStructureRecognizer is not initialized')
    if (image.width <= 0 || image.height <= 0) throw new Error('empty image')
    const ort = getOrt()
    const centerThresh = options.centerThresh ?? this.centerThresh
    const cornerThresh = options.cornerThresh ?? this.cornerThresh
    const { width: w, height: h } = image
    const center: Point = [w / 2, h / 2]
    const scale = Math.max(h, w)
    const trans = getCenterAffine(center, scale, this.inputW, this.inputH)
    const warped = warpAffineLinearBGR(image, trans, this.inputW, this.inputH)
    const plane = this.inputW * this.inputH
    const input = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) {
      for (let ch = 0; ch < 3; ch++) {
        input[ch * plane + i] = f32(f32(warped[i * 3 + ch] / 255) - MEAN[ch]) / STD[ch]
      }
    }
    const tensor = new ort.Tensor('float32', input, [1, 3, this.inputH, this.inputW])
    let results: OrtType.InferenceSession.OnnxValueMapType
    try {
      results = await this.session.run({ [this.inputName]: tensor })
    } finally {
      tensor.dispose?.()
    }
    const fm = (name: string): FeatureMap => {
      const t = results[name] as OrtType.Tensor
      const [, c, hh, ww] = t.dims as number[]
      return { data: t.data as Float32Array, channels: c, height: hh, width: ww }
    }
    const outputs: ModelOutputs = {
      hm: fm('hm'), reg: fm('reg'), ct2cn: fm('ct2cn'), cn2ct: fm('cn2ct'), lc: fm('lc'), sp: fm('sp'),
    }
    const decoded = decodeOfficial(outputs, { centerThresh, cornerThresh })
    const inv = getCenterAffine(center, scale, outputs.hm.width, outputs.hm.height, true)
    const dets = postprocess(decoded, inv, { centerThresh })
    for (const t of Object.values(results)) (t as OrtType.Tensor).dispose?.()
    return dets.map((d) => toTableCell({
      score: d.score,
      corners: d.corners,
      logic: [d.logic[0] - 1, d.logic[1] - 1, d.logic[2] - 1, d.logic[3] - 1],
    }, false))
  }

  dispose(): void {
    this.session?.release?.()
    this.session = null
  }
}

// ---------------------------------------------------------------------------
// ページ単位の処理
// ---------------------------------------------------------------------------

interface MergedRegion {
  index: number
  bbox: BBox
  confidence: number
  sourceTableIndexes: number[]
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return Math.max(a[0], b[0]) < Math.min(a[2], b[2]) && Math.max(a[1], b[1]) < Math.min(a[3], b[3])
}

/** 本家 _merge_overlapping_table_regions: 重なりで連結した領域をその外接矩形に置き換える */
export function mergeOverlappingTableRegions(regions: MergedRegion[]): MergedRegion[] {
  const merged: MergedRegion[] = []
  const visited = new Set<number>()
  for (let start = 0; start < regions.length; start++) {
    if (visited.has(start)) continue
    const component: number[] = []
    const pending = [start]
    visited.add(start)
    while (pending.length) {
      const cur = pending.pop()!
      component.push(cur)
      for (let cand = 0; cand < regions.length; cand++) {
        if (visited.has(cand)) continue
        if (bboxesOverlap(regions[cur].bbox, regions[cand].bbox)) {
          visited.add(cand)
          pending.push(cand)
        }
      }
    }
    const members = component.map((i) => regions[i])
    merged.push({
      index: Math.min(...members.map((m) => m.index)),
      bbox: [
        Math.min(...members.map((m) => Math.trunc(m.bbox[0]))),
        Math.min(...members.map((m) => Math.trunc(m.bbox[1]))),
        Math.max(...members.map((m) => Math.trunc(m.bbox[2]))),
        Math.max(...members.map((m) => Math.trunc(m.bbox[3]))),
      ],
      confidence: Math.max(...members.map((m) => m.confidence)),
      sourceTableIndexes: [...new Set(members.flatMap((m) => m.sourceTableIndexes))].sort((a, b) => a - b),
    })
  }
  return merged
}

/** 本家 extract_table_regions 相当（XML の代わりにレイアウト検出結果を受け取る。座標は整数に切り捨て） */
function toRegions(regions: TableRegionInput[]): MergedRegion[] {
  const out: MergedRegion[] = []
  regions.forEach((r, i) => {
    const x = Math.trunc(r.x), y = Math.trunc(r.y), w = Math.trunc(r.width), h = Math.trunc(r.height)
    if (!(w > 0 && h > 0)) return
    out.push({ index: i, bbox: [x, y, x + w, y + h], confidence: r.confidence, sourceTableIndexes: [i + 1] })
  })
  return mergeOverlappingTableRegions(out)
}

function toOcrLines(lines: TableLineInput[]): OcrLine[] {
  // 本家 json_lines は整数座標（_line_bbox は float32 化）。縦書き判定は h > w
  return lines.map((l, i) => ({
    id: i,
    x1: Math.fround(l.x),
    y1: Math.fround(l.y),
    x2: Math.fround(l.x + l.width),
    y2: Math.fround(l.y + l.height),
    text: l.text,
    isVertical: l.height > l.width,
  }))
}

/**
 * ページ画像・表領域・OCR 済み行から表構造を推定する（本家 infer_tables_from_page）
 * 表領域がなければ [] を返す
 */
export async function inferTablesFromPage(
  image: RGBAImage,
  regions: TableRegionInput[],
  lines: TableLineInput[],
  recognizer: TableStructureRecognizer,
  options: TableOptions = {}
): Promise<TableResult[]> {
  const merged = toRegions(regions)
  if (!merged.length) return []
  const cropPadding = Math.max(0, Math.trunc(options.cropPadding ?? DEFAULT_CROP_PADDING))
  const ocrLines = toOcrLines(lines)
  const tables: TableResult[] = []

  for (let k = 0; k < merged.length; k++) {
    const region = merged[k]
    const [bx1, by1, bx2, by2] = region.bbox
    const tableW = Math.max(1, bx2 - bx1)
    const tableH = Math.max(1, by2 - by1)
    const mx = Math.max(cropPadding, roundHalfEven(tableW * 0.02))
    const my = Math.max(cropPadding, roundHalfEven(tableH * 0.02))
    const x1 = Math.max(0, bx1 - mx)
    const y1 = Math.max(0, by1 - my)
    const x2 = Math.min(image.width, bx2 + mx)
    const y2 = Math.min(image.height, by2 + my)
    const table: TableResult = {
      tableIndex: k + 1,
      layoutBbox: [bx1, by1, bx2, by2],
      cropBbox: [x1, y1, x2, y2],
      layoutConfidence: region.confidence,
      sourceTableIndexes: region.sourceTableIndexes,
      cells: [],
      rows: 0,
      cols: 0,
      structureSource: 'model',
      detectedCellCount: 0,
      recoveredCellCount: 0,
      html: '',
      markdown: '',
    }
    try {
      const crop = cropRGBA(image, x1, y1, x2 - x1, y2 - y1)
      const local = await recognizer.recognize(crop, { centerThresh: options.centerThresh, cornerThresh: options.cornerThresh })
      let cells: WorkCell[] = local.map((c) => {
        const w = fromTableCell(c)
        w.corners = w.corners.map(([px, py]) => [px + x1, py + y1] as Point)
        return w
      })
      // 表領域内に中心がある OCR 行だけを候補にする
      const tableLines = ocrLines.filter((l) => {
        const cx = (l.x1 + l.x2) * 0.5
        const cy = (l.y1 + l.y2) * 0.5
        return bx1 <= cx && cx <= bx2 && by1 <= cy && cy <= by2
      })
      table.detectedCellCount = cells.length
      const ruled = ruledTableCells(image, cells, [bx1, by1, bx2, by2])
      if (ruled) {
        cells = ruled
        table.structureSource = 'ruling_lines'
      }
      if (cells.length) assignOcrLinesToCells(cells, tableLines, [bx1, by1, bx2, by2])
      table.html = cellsToHtml(cells)
      table.markdown = cellsToMarkdown(cells)
      table.recoveredCellCount = cells.filter((c) => c.synthetic).length
      table.cells = cells.map((c) => toTableCell(c, true))
      ;[table.rows, table.cols] = tableGridShape(cells)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[WARN] TableCenterNet failed for table ${k + 1}: ${msg}`)
      table.cells = []
      table.error = msg
      table.html = '<div class="table-error">Table structure inference failed: ' + escapeHtml(msg) + '</div>'
      table.markdown = `_表構造の推定に失敗しました: ${msg.replace(/\|/g, '\\|')}_`
    }
    tables.push(table)
  }
  return tables
}

/** 表 HTML 断片をまとめた単独の UTF-8 HTML 文書（本家 build_tables_html_document） */
export function buildTablesHtmlDocument(sourceName: string, tables: Array<TableResult & { pageIndex?: number }>): string {
  const title = escapeHtml(`Table structures - ${sourceName}`)
  const out = [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '  <meta charset="utf-8">',
    `  <title>${title}</title>`,
    '  <style>',
    '    body{font-family:system-ui,-apple-system,"Yu Gothic",sans-serif;margin:24px;}',
    '    section{margin:0 0 32px 0;}',
    '    .tablecenternet{border-collapse:collapse;margin-top:8px;}',
    '    .tablecenternet td,.tablecenternet th{border:1px solid #555;padding:4px 8px;vertical-align:top;}',
    '    .meta{color:#666;font-size:0.9em;}',
    '    .table-error{color:#b00020;white-space:pre-wrap;}',
    '  </style>',
    '</head>',
    '<body>',
    `<h1>${title}</h1>`,
  ]
  for (const t of tables) {
    const heading = t.pageIndex == null ? `Table ${t.tableIndex}` : `Page ${t.pageIndex + 1} / Table ${t.tableIndex}`
    out.push('<section>')
    out.push(`  <h2>${escapeHtml(heading)}</h2>`)
    // Python の str(list) と同じ表記 "[x1, y1, x2, y2]"
    out.push(`  <div class="meta">layout bbox: ${escapeHtml(`[${t.layoutBbox.join(', ')}]`)}</div>`)
    out.push(t.html)
    out.push('</section>')
  }
  out.push('</body>', '</html>')
  return out.join('\n')
}
