/**
 * 表セルの後処理（本家 tablecenternet.py の移植）
 *   - _ruled_table_cells: 罫線から格子を復元してモデルのセルを置き換える
 *   - _build_logical_ocr_grid / _assign_ocr_lines_to_cells: OCR 行のセル割り当て
 *   - _recover_missing_cells_from_grid: OCR があるのに欠けたセルの補完
 *   - cells_to_html / cells_to_markdown
 */

import type { RGBAImage } from '../image-ops'
import { rgbaToGray, adaptiveThresholdMeanInv, morphOpenRect, roundHalfEven, type GrayImage, type Point } from './cv-ops'

const f32 = Math.fround

/** 内部のセル表現（本家の dict に相当） */
export interface WorkCell {
  score: number
  corners: Point[]
  /** 0 始まり [c1, c2, r1, r2] */
  logic: [number, number, number, number]
  synthetic?: boolean
  structureSource?: 'ruling_lines'
  recoveryNeighborCount?: number
  ocrLines?: OcrLine[]
}

/** OCR 行（ページ座標） */
export interface OcrLine {
  /** 入力順のインデックス（本家の id） */
  id: number
  x1: number
  y1: number
  x2: number
  y2: number
  text: string
  isVertical: boolean
}

export type BBox = [number, number, number, number]

// ---------------------------------------------------------------------------
// 小物
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  if (n === 0) return NaN
  return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/** float32 配列に対する np.median（2 値の平均も float32） */
function medianF32(values: number[]): number {
  const s = values.map(f32).sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) >> 1] : f32(f32(s[n / 2 - 1] + s[n / 2]) / 2)
}

/** np.interp（xp は昇順） */
function interp(x: number, xp: number[], fp: number[]): number {
  if (x <= xp[0]) return fp[0]
  if (x >= xp[xp.length - 1]) return fp[fp.length - 1]
  let i = 1
  while (xp[i] < x) i++
  const t = (x - xp[i - 1]) / (xp[i] - xp[i - 1])
  return fp[i - 1] + t * (fp[i] - fp[i - 1])
}

export function cellGridRange(cell: WorkCell): [number, number, number, number] | null {
  let [c1, c2, r1, r2] = cell.logic.map((v) => Math.trunc(v))
  if (![c1, c2, r1, r2].every(Number.isFinite)) return null
  ;[c1, c2] = [Math.min(c1, c2), Math.max(c1, c2)]
  ;[r1, r2] = [Math.min(r1, r2), Math.max(r1, r2)]
  if (Math.min(c1, r1) < 0 || Math.max(c2, r2) > 255) return null
  return [c1, c2, r1, r2]
}

/** 論理的な行数・列数（結合セルを含む） */
export function tableGridShape(cells: WorkCell[]): [number, number] {
  let rows = 0
  let cols = 0
  for (const cell of cells) {
    const g = cellGridRange(cell)
    if (g) {
      rows = Math.max(rows, g[3] + 1)
      cols = Math.max(cols, g[1] + 1)
    }
  }
  return [rows, cols]
}

function lineBBox(line: OcrLine): BBox {
  return [line.x1, line.y1, line.x2, line.y2]
}

function bboxIntersectionRatio(a: BBox, b: BBox): number {
  const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const area = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1])
  return area > 0 ? (iw * ih) / area : 0
}

function bboxIou(a: BBox, b: BBox): number {
  const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const inter = iw * ih
  if (inter <= 0) return 0
  const union = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]) + Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) - inter
  return union > 0 ? inter / union : 0
}

// ---------------------------------------------------------------------------
// 罫線による格子復元
// ---------------------------------------------------------------------------

/** 罫線の完全な枠が見つかれば、回帰した論理座標の代わりに罫線格子からセルを作る */
export function ruledTableCells(image: RGBAImage, cells: WorkCell[], tableBBox: BBox): WorkCell[] | null {
  const { width, height } = image
  let [x1, y1, x2, y2] = tableBBox.map((v) => roundHalfEven(v))
  x1 = Math.max(0, x1); y1 = Math.max(0, y1)
  x2 = Math.min(width, x2); y2 = Math.min(height, y2)
  if (x2 - x1 < 32 || y2 - y1 < 32 || cells.length === 0) return null
  const gray = rgbaToGray(image, x1, y1, x2 - x1, y2 - y1)
  const binary = adaptiveThresholdMeanInv(gray, 31, 10)
  const h = gray.height
  const w = gray.width
  const tolerance = Math.max(2, roundHalfEven(Math.min(h, w) * 0.004))
  const boundaries: number[][] = []
  let strongRulings = true
  for (const axis of [0, 1] as const) {
    const mask = axis === 0
      ? morphOpenRect(binary, 1, Math.max(15, Math.floor(h / 30)))
      : morphOpenRect(binary, Math.max(15, Math.floor(w / 30)), 1)
    // axis 0: 列ごとの縦方向の画素率、axis 1: 行ごとの横方向の画素率
    const n = axis === 0 ? w : h
    const denom = axis === 0 ? h : w
    const support = new Float64Array(n)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask.data[y * w + x]) support[axis === 0 ? x : y]++
      }
    }
    for (let i = 0; i < n; i++) support[i] /= denom
    const groups: number[][] = []
    for (let i = 0; i < n; i++) {
      if (!(support[i] > 0.15)) continue
      if (groups.length === 0 || i - groups[groups.length - 1][groups[groups.length - 1].length - 1] > tolerance) groups.push([i])
      else groups[groups.length - 1].push(i)
    }
    const values = groups.map((g) => {
      let s = 0, sw = 0
      for (const i of g) { s += i * support[i]; sw += support[i] }
      return s / sw
    })
    const extent = axis === 0 ? w : h
    if (values.length < 3 || values.length > 256) return null
    const maxSupport = (g: number[]) => Math.max(...g.map((i) => support[i]))
    let minDiff = Infinity
    for (let i = 1; i < values.length; i++) minDiff = Math.min(minDiff, values[i] - values[i - 1])
    if (
      values[0] > extent * 0.03 ||
      values[values.length - 1] < extent * 0.97 ||
      Math.min(maxSupport(groups[0]), maxSupport(groups[groups.length - 1])) < 0.5 ||
      minDiff <= tolerance * 2
    ) return null
    const strengths = groups.map(maxSupport)
    strongRulings = strongRulings && (
      Math.min(strengths[0], strengths[strengths.length - 1]) >= 0.8 &&
      strengths.filter((s) => s >= 0.8).length / strengths.length >= 0.75
    )
    boundaries.push(values)
  }
  const [xs, ys] = boundaries
  const rows = ys.length - 1
  const cols = xs.length - 1
  const diffs = (a: number[]) => a.slice(1).map((v, i) => v - a[i])
  const argminAbs = (a: number[], v: number) => {
    let best = 0
    for (let i = 1; i < a.length; i++) if (Math.abs(a[i] - v) < Math.abs(a[best] - v)) best = i
    return best
  }
  const minAbs = (a: number[], v: number) => Math.min(...a.map((t) => Math.abs(t - v)))

  // 枠だけでは不十分: 予測セルの物理的な辺が復元した軸と一致していることを確認する
  let aligned = 0
  let valid = 0
  const predictedSpans: [number, number, number, number][] = []
  const predictedSingle = new Set<string>()
  const xTol = Math.max(tolerance * 2, median(diffs(xs)) * 0.2)
  const yTol = Math.max(tolerance * 2, median(diffs(ys)) * 0.2)
  for (const cell of cells) {
    const pts = cell.corners
    if (pts.length !== 4 || !pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue
    valid++
    const left = Math.min(...pts.map((p) => p[0])) - x1
    const right = Math.max(...pts.map((p) => p[0])) - x1
    const top = Math.min(...pts.map((p) => p[1])) - y1
    const bottom = Math.max(...pts.map((p) => p[1])) - y1
    if (minAbs(xs, left) <= xTol && minAbs(xs, right) <= xTol && minAbs(ys, top) <= yTol && minAbs(ys, bottom) <= yTol) {
      aligned++
      const c1 = argminAbs(xs, left), c2 = argminAbs(xs, right)
      const r1 = argminAbs(ys, top), r2 = argminAbs(ys, bottom)
      if (c2 > c1 && r2 > r1 && (c2 - c1) * (r2 - r1) > 1) predictedSpans.push([c1, c2 - 1, r1, r2 - 1])
      else if (c2 === c1 + 1 && r2 === r1 + 1) predictedSingle.add(`${r1},${c1}`)
    }
  }
  const requiredAlignment = strongRulings ? 0.25 : 0.7
  if (!valid || aligned < valid * requiredAlignment) return null

  // 短いカーネルでセル内だけにある区切り線も残す
  const vertical = morphOpenRect(binary, 1, Math.max(5, Math.trunc(Math.min(...diffs(ys)) * 0.6)))
  const horizontal = morphOpenRect(binary, Math.max(5, Math.trunc(Math.min(...diffs(xs)) * 0.6)), 1)

  const separator = (mask: GrayImage, axis: 0 | 1, position: number, start: number, end: number, threshold = 0.25): boolean => {
    const inset = Math.min(tolerance, (end - start) * 0.15)
    const lo = Math.max(0, roundHalfEven(start + inset))
    const pos = roundHalfEven(position)
    const b0 = Math.max(0, pos - tolerance)
    if (axis === 0) {
      const hi = Math.min(h, roundHalfEven(end - inset))
      const b1 = Math.min(w, pos + tolerance + 1)
      if (hi <= lo) return false // np.mean([]) は nan → False
      let hit = 0
      for (let y = lo; y < hi; y++) {
        for (let x = b0; x < b1; x++) if (mask.data[y * w + x]) { hit++; break }
      }
      return hit / (hi - lo) >= threshold
    }
    const hi = Math.min(w, roundHalfEven(end - inset))
    const b1 = Math.min(h, pos + tolerance + 1)
    if (hi <= lo) return false
    let hit = 0
    for (let x = lo; x < hi; x++) {
      for (let y = b0; y < b1; y++) if (mask.data[y * w + x]) { hit++; break }
    }
    return hit / (hi - lo) >= threshold
  }

  const parent = Array.from({ length: rows * cols }, (_, i) => i)
  const find = (i: number) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const join = (a: number, b: number) => { parent[find(a)] = find(b) }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c
      if (c && !(separator(vertical, 0, xs[c], ys[r], ys[r + 1]) || separator(binary, 0, xs[c], ys[r], ys[r + 1], 0.8))) {
        join(index, index - 1)
      }
      if (r && !(separator(horizontal, 1, ys[r], xs[c], xs[c + 1]) || separator(binary, 1, ys[r], xs[c], xs[c + 1], 0.8))) {
        join(index, index - cols)
      }
    }
  }

  const components = new Map<number, [number, number][]>()
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const root = find(r * cols + c)
      if (!components.has(root)) components.set(root, [])
      components.get(root)!.push([r, c])
    }
  }

  const result: WorkCell[] = []
  for (const slots of components.values()) {
    const r1 = Math.min(...slots.map((s) => s[0])), c1 = Math.min(...slots.map((s) => s[1]))
    const r2 = Math.max(...slots.map((s) => s[0])), c2 = Math.max(...slots.map((s) => s[1]))
    const area = (r2 - r1 + 1) * (c2 - c1 + 1)
    let corroborated = slots.length === 1 || predictedSpans.some(([pc1, pc2, pr1, pr2]) =>
      c1 <= pc1 && pc1 <= pc2 && pc2 <= c2 && r1 <= pr1 && pr1 <= pr2 && pr2 <= r2 &&
      (pc2 - pc1 + 1) * (pr2 - pr1 + 1) >= area * 0.5)
    if (strongRulings && !slots.some(([r, c]) => predictedSingle.has(`${r},${c}`))) corroborated = true
    // インク欠けだけでは結合の根拠にしない
    const ranges: [number, number, number, number][] = slots.length === area && corroborated
      ? [[c1, c2, r1, r2]]
      : slots.map(([r, c]) => [c, c, r, r])
    for (const [a1, a2, b1, b2] of ranges) {
      const left = xs[a1] + x1, right = xs[a2 + 1] + x1
      const top = ys[b1] + y1, bottom = ys[b2 + 1] + y1
      result.push({
        score: 0,
        corners: [[left, top], [right, top], [right, bottom], [left, bottom]],
        logic: [a1, a2, b1, b2],
        structureSource: 'ruling_lines',
      })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// 論理グリッドと OCR 行の割り当て
// ---------------------------------------------------------------------------

interface LogicalGrid {
  xb: number[]
  yb: number[]
  grid: OcrLine[][][]
}

/** 外枠を固定して内部境界を投票の中央値で埋め、厳密単調にする（本家 repopulate） */
function repopulate(n: number, votes: Map<number, number[]>, lo: number, hi: number): number[] {
  const result = new Array<number>(n).fill(NaN)
  result[0] = f32(lo)
  result[n - 1] = f32(hi)
  const span = Math.max(hi - lo, 1)
  const eps = Math.max(span * 1e-5, 1e-3)
  for (const [idx, coords] of votes) {
    if (idx > 0 && idx < n - 1 && coords.length) {
      result[idx] = f32(Math.min(Math.max(medianF32(coords), lo + eps), hi - eps))
    }
  }
  const known: number[] = []
  for (let i = 0; i < n; i++) if (Number.isFinite(result[i])) known.push(i)
  const knownVals = known.map((i) => result[i])
  for (let i = 0; i < n; i++) if (!Number.isFinite(result[i])) result[i] = f32(interp(i, known, knownVals))
  for (let i = 1; i < n - 1; i++) {
    const minAllowed = f32(result[i - 1] + eps)
    const maxAllowed = hi - eps * (n - 1 - i)
    result[i] = f32(Math.min(Math.max(result[i], minAllowed), maxAllowed))
  }
  result[0] = f32(lo)
  result[n - 1] = f32(hi)
  return result
}

function buildLogicalOcrGrid(cells: WorkCell[], tableBBox: BBox | null, ocrLines: OcrLine[]): LogicalGrid | null {
  const xVotes = new Map<number, number[]>()
  const yVotes = new Map<number, number[]>()
  const vote = (m: Map<number, number[]>, k: number, ...v: number[]) => {
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(...v)
  }
  const allX: number[] = []
  const allY: number[] = []
  const unitW: number[] = []
  const unitH: number[] = []
  let maxCol = -1
  let maxRow = -1
  for (const cell of cells) {
    const g = cellGridRange(cell)
    if (!g || cell.corners.length !== 4) continue
    const pts = cell.corners.map(([x, y]) => [f32(x), f32(y)] as Point)
    if (!pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue
    const [c1, c2, r1, r2] = g
    maxCol = Math.max(maxCol, c2)
    maxRow = Math.max(maxRow, r2)
    const [tl, tr, br, bl] = pts
    vote(xVotes, c1, tl[0], bl[0])
    vote(xVotes, c2 + 1, tr[0], br[0])
    vote(yVotes, r1, tl[1], tr[1])
    vote(yVotes, r2 + 1, bl[1], br[1])
    for (const p of pts) { allX.push(p[0]); allY.push(p[1]) }
    const colSpan = Math.max(1, c2 - c1 + 1)
    const rowSpan = Math.max(1, r2 - r1 + 1)
    const leftX = f32(f32(tl[0] + bl[0]) * 0.5)
    const rightX = f32(f32(tr[0] + br[0]) * 0.5)
    const topY = f32(f32(tl[1] + tr[1]) * 0.5)
    const bottomY = f32(f32(bl[1] + br[1]) * 0.5)
    if (rightX > leftX) unitW.push((rightX - leftX) / colSpan)
    if (bottomY > topY) unitH.push((bottomY - topY) / rowSpan)
  }
  if (maxCol < 0 || maxRow < 0 || !allX.length || !allY.length) return null

  let tx1: number, ty1: number, tx2: number, ty2: number
  if (tableBBox) {
    ;[tx1, ty1, tx2, ty2] = tableBBox
    if (tx2 <= tx1 || ty2 <= ty1) [tx1, ty1, tx2, ty2] = [Math.min(...allX), Math.min(...allY), Math.max(...allX), Math.max(...allY)]
  } else {
    ;[tx1, ty1, tx2, ty2] = [Math.min(...allX), Math.min(...allY), Math.max(...allX), Math.max(...allY)]
  }
  const baseCols = maxCol + 1
  const baseRows = maxRow + 1
  const medianW = Math.max(unitW.length ? median(unitW) : Math.max((tx2 - tx1) / Math.max(baseCols, 1), 1), 1)
  const medianH = Math.max(unitH.length ? median(unitH) : Math.max((ty2 - ty1) / Math.max(baseRows, 1), 1), 1)
  let detectedRight = -Infinity
  for (const v of xVotes.values()) for (const x of v) detectedRight = Math.max(detectedRight, x)
  let detectedBottom = -Infinity
  for (const v of yVotes.values()) for (const y of v) detectedBottom = Math.max(detectedBottom, y)
  const rightGap = Math.max(0, tx2 - detectedRight)
  const bottomGap = Math.max(0, ty2 - detectedBottom)

  const hasOcrInBand = (axis: 'x' | 'y', start: number, end: number) => {
    if (end <= start) return false
    return ocrLines.some((l) => {
      const cx = (l.x1 + l.x2) * 0.5
      const cy = (l.y1 + l.y2) * 0.5
      return axis === 'x'
        ? start <= cx && cx <= end && ty1 <= cy && cy <= ty2
        : start <= cy && cy <= end && tx1 <= cx && cx <= tx2
    })
  }
  let extraCols = 0
  if (rightGap >= medianW * 0.55 && hasOcrInBand('x', detectedRight, tx2)) {
    extraCols = Math.min(Math.max(1, roundHalfEven(rightGap / medianW)), 32)
  }
  let extraRows = 0
  if (bottomGap >= medianH * 0.55 && hasOcrInBand('y', detectedBottom, ty2)) {
    extraRows = Math.min(Math.max(1, roundHalfEven(bottomGap / medianH)), 32)
  }
  const cols = baseCols + extraCols
  const rows = baseRows + extraRows
  // 本家は _interpolate_grid_boundaries の結果を repopulate で全て上書きするため、ここでは repopulate のみ
  const xb = repopulate(cols + 1, xVotes, tx1, tx2)
  const yb = repopulate(rows + 1, yVotes, ty1, ty2)
  const grid: OcrLine[][][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []))
  return { xb, yb, grid }
}

/** np.searchsorted(a, v, side='right') */
function searchSortedRight(a: number[], v: number): number {
  let lo = 0, hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return lo
}

function gridSlotForOcrLine(bbox: BBox, xb: number[], yb: number[]): [number, number] | null {
  const cx = (bbox[0] + bbox[2]) * 0.5
  const cy = (bbox[1] + bbox[3]) * 0.5
  const cols = xb.length - 1
  const rows = yb.length - 1
  if (cols <= 0 || rows <= 0) return null
  if (xb[0] <= cx && cx <= xb[cols] && yb[0] <= cy && cy <= yb[rows]) {
    const c = Math.min(Math.max(searchSortedRight(xb, cx) - 1, 0), cols - 1)
    const r = Math.min(Math.max(searchSortedRight(yb, cy) - 1, 0), rows - 1)
    return [r, c]
  }
  // 外枠から少しはみ出した行: 覆う割合が最大のスロット（0.2 以上）
  let best: [number, number] | null = null
  let bestRatio = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ratio = bboxIntersectionRatio(bbox, [xb[c], yb[r], xb[c + 1], yb[r + 1]])
      if (ratio > bestRatio) { bestRatio = ratio; best = [r, c] }
    }
  }
  return bestRatio >= 0.2 ? best : null
}

function deduplicateAssigned(assigned: [number, number, OcrLine][], iouThreshold: number): [number, number, OcrLine][] {
  const cands = assigned.map(([r, c, line], order) => {
    const b = lineBBox(line)
    return { area: Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]), order, r, c, line, b }
  })
  cands.sort((a, b) => b.area - a.area || a.order - b.order)
  const kept: typeof cands = []
  for (const cand of cands) {
    if (kept.some((k) => bboxIou(cand.b, k.b) >= iouThreshold)) continue
    kept.push(cand)
  }
  kept.sort((a, b) => a.order - b.order)
  return kept.map((k) => [k.r, k.c, k.line])
}

function sortOcrLinesInGrid(lines: OcrLine[]): OcrLine[] {
  const copied = [...lines]
  if (!copied.length) return copied
  const vertical = copied.filter((l) => l.isVertical).length > copied.length / 2
  if (vertical) copied.sort((a, b) => -a.x1 - -b.x1 || a.y1 - b.y1)
  else copied.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)
  return copied
}

function recoverMissingCells(cells: WorkCell[], lg: LogicalGrid, outerFrameSupport: boolean): WorkCell[] {
  const { grid, xb, yb } = lg
  const rows = grid.length
  const cols = rows ? grid[0].length : 0
  if (rows <= 0 || cols <= 0) return []
  const occupied = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false))
  for (const cell of cells) {
    const g = cellGridRange(cell)
    if (!g) continue
    const [c1, c2, r1, r2] = g
    if (r1 >= rows || c1 >= cols) continue
    for (let r = r1; r <= Math.min(r2, rows - 1); r++) for (let c = c1; c <= Math.min(c2, cols - 1); c++) occupied[r][c] = true
  }
  const recovered: WorkCell[] = []
  const neighbourCount = (r: number, c: number) => {
    let n = 0
    if (r > 0 && occupied[r - 1][c]) n++
    if (r + 1 < rows && occupied[r + 1][c]) n++
    if (c > 0 && occupied[r][c - 1]) n++
    if (c + 1 < cols && occupied[r][c + 1]) n++
    if (outerFrameSupport && (r === 0 || r === rows - 1 || c === 0 || c === cols - 1)) n++
    return n
  }
  for (;;) {
    const cands: [number, number, number][] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (occupied[r][c] || !grid[r][c].length) continue
        const s = neighbourCount(r, c)
        if (s >= 2) cands.push([r, c, s])
      }
    }
    if (!cands.length) break
    cands.sort((a, b) => b[2] - a[2] || a[0] - b[0] || a[1] - b[1])
    let changed = false
    for (const [r, c] of cands) {
      if (occupied[r][c]) continue
      const support = neighbourCount(r, c)
      if (support < 2) continue
      const x1 = xb[c], x2 = xb[c + 1], y1 = yb[r], y2 = yb[r + 1]
      if (!(x2 > x1 && y2 > y1)) continue
      const cell: WorkCell = {
        score: 0,
        corners: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
        logic: [c, c, r, r],
        synthetic: true,
        recoveryNeighborCount: support,
        ocrLines: [],
      }
      cells.push(cell)
      recovered.push(cell)
      occupied[r][c] = true
      changed = true
    }
    if (!changed) break
  }
  return recovered
}

/** OCR 行を論理グリッド経由でセルに割り当てる（cells を直接更新し、補完セルを追加する） */
export function assignOcrLinesToCells(cells: WorkCell[], ocrLines: OcrLine[], tableBBox: BBox | null, iouThreshold = 0.5): void {
  for (const cell of cells) cell.ocrLines = []
  const lg = buildLogicalOcrGrid(cells, tableBBox, ocrLines)
  if (!lg) return
  const { xb, yb, grid } = lg
  const assigned: [number, number, OcrLine][] = []
  for (const line of ocrLines) {
    const slot = gridSlotForOcrLine(lineBBox(line), xb, yb)
    if (slot) assigned.push([slot[0], slot[1], line])
  }
  for (const [r, c, line] of deduplicateAssigned(assigned, iouThreshold)) grid[r][c].push(line)
  for (const row of grid) for (let c = 0; c < row.length; c++) row[c] = sortOcrLinesInGrid(row[c])

  recoverMissingCells(cells, lg, tableBBox !== null)

  for (const cell of cells) {
    const g = cellGridRange(cell)
    if (!g) continue
    const [c1, c2, r1, r2] = g
    if (r2 >= grid.length || c2 >= grid[0].length) continue
    const covered: OcrLine[] = []
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) covered.push(...grid[r][c])
    const vertical = covered.length ? covered.filter((l) => l.isVertical).length > covered.length / 2 : false
    const ordered: OcrLine[] = []
    if (vertical) {
      for (let c = c2; c >= c1; c--) for (let r = r1; r <= r2; r++) ordered.push(...grid[r][c])
    } else {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ordered.push(...grid[r][c])
    }
    const seen = new Set<OcrLine>()
    cell.ocrLines = ordered.filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
  }
}

// ---------------------------------------------------------------------------
// HTML / Markdown
// ---------------------------------------------------------------------------

/** Python html.escape(quote=True) */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

function sortedLines(cell: WorkCell): OcrLine[] {
  return [...(cell.ocrLines ?? [])].sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)
}

/** 論理開始位置ごとのセル（重複時は高スコア優先）と最大行・列 */
function collectStarts(cells: WorkCell[]) {
  const starts = new Map<string, { cell: WorkCell; g: [number, number, number, number] }>()
  let maxRow = 0
  let maxCol = 0
  const sorted = cells.map((c, i) => ({ c, i })).sort((a, b) => b.c.score - a.c.score || a.i - b.i)
  for (const { c } of sorted) {
    const g = cellGridRange(c)
    if (!g) continue
    const key = `${g[2]},${g[0]}`
    if (!starts.has(key)) starts.set(key, { cell: c, g })
    maxRow = Math.max(maxRow, g[3])
    maxCol = Math.max(maxCol, g[1])
  }
  return { starts, maxRow, maxCol }
}

/** rowspan / colspan つき HTML（cells_to_html 相当。OCR 行の割り当ては済んでいること） */
export function cellsToHtml(cells: WorkCell[]): string {
  const empty = '<table class="tablecenternet"><tbody></tbody></table>'
  if (!cells.length) return empty
  const { starts, maxRow, maxCol } = collectStarts(cells)
  if (!starts.size) return empty
  const occupied = new Set<string>()
  const out = ['<table class="tablecenternet">', '  <tbody>']
  for (let r = 0; r <= maxRow; r++) {
    out.push('    <tr>')
    for (let c = 0; c <= maxCol; c++) {
      if (occupied.has(`${r},${c}`)) continue
      const s = starts.get(`${r},${c}`)
      if (!s) {
        out.push('      <td></td>')
        continue
      }
      const [c1, c2, r1, r2] = s.g
      const attrs: string[] = []
      if (r2 - r1 + 1 > 1) attrs.push(`rowspan="${r2 - r1 + 1}"`)
      if (c2 - c1 + 1 > 1) attrs.push(`colspan="${c2 - c1 + 1}"`)
      const attrText = attrs.length ? ' ' + attrs.join(' ') : ''
      const content = sortedLines(s.cell).filter((l) => l.text).map((l) => escapeHtml(l.text)).join('<br>')
      out.push(`      <td${attrText}>${content}</td>`)
      for (let rr = r1; rr <= r2; rr++) for (let cc = c1; cc <= c2; cc++) occupied.add(`${rr},${cc}`)
    }
    out.push('    </tr>')
  }
  out.push('  </tbody>', '</table>')
  return out.join('\n')
}

export function cellText(cell: WorkCell): string {
  return sortedLines(cell).filter((l) => l.text).map((l) => l.text).join('<br>')
}

/** GitHub 形式の Markdown 表（cells_to_markdown 相当。結合セルの文字列は各スロットに複製） */
export function cellsToMarkdown(cells: WorkCell[]): string {
  if (!cells.length) return '_表セルを検出できませんでした。_'
  const { starts, maxRow, maxCol } = collectStarts(cells)
  if (!starts.size) return '_有効な表グリッドを復元できませんでした。_'
  const rows = maxRow + 1
  const cols = maxCol + 1
  const grid = Array.from({ length: rows }, () => new Array<string>(cols).fill(''))
  for (const { cell, g } of starts.values()) {
    const text = cellText(cell).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r/g, '').replace(/\n/g, '<br>')
    for (let r = g[2]; r <= g[3]; r++) for (let c = g[0]; c <= g[1]; c++) grid[r][c] = text
  }
  const header = '| ' + grid[0].join(' | ') + ' |'
  const sep = '| ' + new Array(cols).fill('---').join(' | ') + ' |'
  return [header, sep, ...grid.slice(1).map((row) => '| ' + row.join(' | ') + ' |')].join('\n')
}
