/**
 * TableCenterNet の出力デコード（本家 tablecenternet.py の decode_official / postprocess の移植）
 *
 * モデル出力（いずれも [1, C, H, W] float32、H = W = 入力 / 4）:
 *   hm     [2]: 0 = セル中心、1 = セル角のヒートマップ（ロジット）
 *   reg    [2]: 点のサブピクセルオフセット
 *   ct2cn  [8]: 中心 → 4 角へのベクトル（TL, TR, BR, BL）
 *   cn2ct  [8]: 角 → 周囲 4 セル中心へのベクトル
 *   lc     [2]: 論理座標（列, 行）マップ
 *   sp     [2]: セルの span（列数, 行数）
 */

import { pointPolygonTest, convexIntersectionArea, contourArea, applyAffine, type Affine, type Point } from './cv-ops'

const f32 = Math.fround

export const DEFAULT_CENTER_K = 3000
export const DEFAULT_CORNER_K = 5000
export const DEFAULT_CENTER_THRESH = 0.2
export const DEFAULT_CORNER_THRESH = 0.3
export const DEFAULT_IOU_THRESH = 0.5
const CELL_MIN_OPTIMIZE_COUNT = 2
const CELL_DECAY = 0.4

export interface FeatureMap {
  data: Float32Array
  channels: number
  height: number
  width: number
}

export interface ModelOutputs {
  hm: FeatureMap
  reg: FeatureMap
  ct2cn: FeatureMap
  cn2ct: FeatureMap
  lc: FeatureMap
  sp: FeatureMap
}

export interface DecodedCell {
  /** 特徴マップ座標の 4 角（TL, TR, BR, BL） */
  polygon: Point[]
  score: number
  /** 1 始まり [start_col, end_col, start_row, end_row] */
  logic: [number, number, number, number]
  cornerCounts: [number, number]
}

/** numpy.rint（偶数丸め） */
function rint(v: number): number {
  const r = Math.round(v)
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

const roundAtLeastOne = (v: number) => Math.max(1, rint(v))

function at(f: FeatureMap, c: number, y: number, x: number): number {
  return f.data[(c * f.height + y) * f.width + x]
}

interface PolygonDecode {
  scores: number[]
  inds: number[]
  px: number[]
  py: number[]
  polygons: Point[][]
}

/**
 * polygons_decode: 3x3 の極大抑制 → 上位 k 点 → オフセットとベクトルで多角形化
 * しきい値未満の点は以降で使われないため、threshold 以上の点だけを返す（上位 k 件の範囲内）
 */
function polygonsDecode(heat: Float32Array, h: number, w: number, vec: FeatureMap, reg: FeatureMap, k: number, threshold: number): PolygonDecode {
  const cand: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = heat[y * w + x]
      if (v < threshold) continue
      let isMax = true
      // cv2.dilate(3x3, BORDER_CONSTANT=0) との一致判定（sigmoid > 0 なので範囲外は無視でよい）
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          if (heat[yy * w + xx] > v) { isMax = false; break }
        }
      }
      if (isMax) cand.push(y * w + x)
    }
  }
  cand.sort((a, b) => heat[b] - heat[a] || a - b)
  if (cand.length > k) cand.length = k
  const out: PolygonDecode = { scores: [], inds: [], px: [], py: [], polygons: [] }
  for (const ind of cand) {
    const ys = Math.floor(ind / w)
    const xs = ind % w
    const px = f32(xs + at(reg, 0, ys, xs))
    const py = f32(ys + at(reg, 1, ys, xs))
    const poly: Point[] = []
    for (let j = 0; j < 4; j++) poly.push([f32(px - at(vec, 2 * j, ys, xs)), f32(py - at(vec, 2 * j + 1, ys, xs))])
    out.scores.push(heat[ind]); out.inds.push(ind); out.px.push(px); out.py.push(py); out.polygons.push(poly)
  }
  return out
}

function sigmoidChannel(hm: FeatureMap, c: number): Float32Array {
  const n = hm.height * hm.width
  const out = new Float32Array(n)
  const off = c * n
  for (let i = 0; i < n; i++) {
    const x = Math.min(50, Math.max(-50, hm.data[off + i]))
    out[i] = 1 / (1 + Math.exp(-x))
  }
  return out
}

/** TableCenterNet mtable の論理座標復元（1 始まり） */
export function getLogicCoords(lc: number[][], span: [number, number]): [number, number, number, number] {
  const colSpan = roundAtLeastOne(span[0])
  const rowSpan = roundAtLeastOne(span[1])
  const cols = lc.map((v) => roundAtLeastOne(v[0]))
  const rows = lc.map((v) => roundAtLeastOne(v[1]))
  let startCol: number, endCol: number, startRow: number, endRow: number
  if (cols[0] === cols[3]) {
    startCol = cols[0]
    endCol = startCol + colSpan - 1
  } else if (cols[1] === cols[2]) {
    endCol = Math.max(colSpan + 1, cols[1]) - 1
    startCol = endCol + 1 - colSpan
  } else if (Math.abs(f32(lc[0][0] - lc[3][0])) <= Math.abs(f32(lc[1][0] - lc[2][0]))) {
    startCol = roundAtLeastOne((lc[0][0] + lc[3][0]) / 2)
    endCol = startCol + colSpan - 1
  } else {
    endCol = Math.max(colSpan + 1, rint((lc[1][0] + lc[2][0]) / 2)) - 1
    startCol = endCol + 1 - colSpan
  }
  if (rows[0] === rows[1]) {
    startRow = rows[0]
    endRow = startRow + rowSpan - 1
  } else if (rows[2] === rows[3]) {
    endRow = Math.max(rowSpan + 1, rows[2]) - 1
    startRow = endRow + 1 - rowSpan
  } else if (Math.abs(f32(lc[0][1] - lc[1][1])) <= Math.abs(f32(lc[2][1] - lc[3][1]))) {
    startRow = roundAtLeastOne((lc[0][1] + lc[1][1]) / 2)
    endRow = startRow + rowSpan - 1
  } else {
    endRow = Math.max(rowSpan + 1, rint((lc[2][1] + lc[3][1]) / 2)) - 1
    startRow = endRow + 1 - rowSpan
  }
  return [startCol, endCol, startRow, endRow]
}

function sampleLcAtPolygon(lc: FeatureMap, polygon: Point[]): number[][] {
  return polygon.map(([x, y]) => {
    const xi = Math.min(Math.max(Math.trunc(x), 0), lc.width - 1)
    const yi = Math.min(Math.max(Math.trunc(y), 0), lc.height - 1)
    return [at(lc, 0, yi, xi), at(lc, 1, yi, xi)]
  })
}

function aabbIntersects(a: Point[], b: Point[]): boolean {
  let aminx = Infinity, aminy = Infinity, amaxx = -Infinity, amaxy = -Infinity
  let bminx = Infinity, bminy = Infinity, bmaxx = -Infinity, bmaxy = -Infinity
  for (const [x, y] of a) { aminx = Math.min(aminx, x); aminy = Math.min(aminy, y); amaxx = Math.max(amaxx, x); amaxy = Math.max(amaxy, y) }
  for (const [x, y] of b) { bminx = Math.min(bminx, x); bminy = Math.min(bminy, y); bmaxx = Math.max(bmaxx, x); bmaxy = Math.max(bmaxy, y) }
  return !(aminx > bmaxx || bminx > amaxx || aminy > bmaxy || bminy > amaxy)
}

function nearestCornerIndex(poly: Point[], x: number, y: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < 4; i++) {
    const dx = f32(poly[i][0] - x)
    const dy = f32(poly[i][1] - y)
    const d = f32(f32(dx * dx) + f32(dy * dy))
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

function sqDist(a: Point, b: Point): number {
  const dx = f32(a[0] - b[0])
  const dy = f32(a[1] - b[1])
  return f32(f32(dx * dx) + f32(dy * dy))
}

/** 本家既定の decode_official（角の再配置つき） */
export function decodeOfficial(
  out: ModelOutputs,
  opts: { centerK?: number; cornerK?: number; centerThresh?: number; cornerThresh?: number } = {}
): DecodedCell[] {
  const centerK = opts.centerK ?? DEFAULT_CENTER_K
  const cornerK = opts.cornerK ?? DEFAULT_CORNER_K
  const centerThresh = opts.centerThresh ?? DEFAULT_CENTER_THRESH
  const cornerThresh = opts.cornerThresh ?? DEFAULT_CORNER_THRESH
  const { height: h, width: w } = out.hm

  const center = polygonsDecode(sigmoidChannel(out.hm, 0), h, w, out.ct2cn, out.reg, centerK, centerThresh)
  const corner = polygonsDecode(sigmoidChannel(out.hm, 1), h, w, out.cn2ct, out.reg, cornerK, cornerThresh)
  const cornerLogics = corner.inds.map((ind) => {
    const y = Math.floor(ind / w), x = ind % w
    return [at(out.lc, 0, y, x), at(out.lc, 1, y, x)]
  })

  const cells: DecodedCell[] = []
  for (let i = 0; i < center.scores.length; i++) {
    const origin = center.polygons[i]
    const fixed: Point[] = origin.map((p) => [p[0], p[1]] as Point)
    const lcLogic: (number[] | null)[] = [null, null, null, null]
    let firstFixes = 0
    let replacementFixes = 0
    for (let j = 0; j < corner.scores.length; j++) {
      const cand = corner.polygons[j]
      if (!aabbIntersects(origin, cand)) continue
      if (!cand.some(([x, y]) => pointPolygonTest(origin, x, y) > 0)) continue
      const cxy: Point = [corner.px[j], corner.py[j]]
      const ci = nearestCornerIndex(origin, cxy[0], cxy[1])
      const o = origin[ci]
      const cur = fixed[ci]
      if (cur[0] === o[0] && cur[1] === o[1]) {
        firstFixes++
        fixed[ci] = cxy
        lcLogic[ci] = cornerLogics[j]
      } else if (sqDist(o, cur) >= sqDist(o, cxy)) {
        replacementFixes++
        fixed[ci] = cxy
        lcLogic[ci] = cornerLogics[j]
      }
    }
    const fallback = sampleLcAtPolygon(out.lc, fixed)
    const lcAll = lcLogic.map((v, j) => v ?? fallback[j])
    const y = Math.floor(center.inds[i] / w), x = center.inds[i] % w
    const logic = getLogicCoords(lcAll, [at(out.sp, 0, y, x), at(out.sp, 1, y, x)])
    let score = center.scores[i]
    // 角の再配置が少ないセルは信頼度を減衰（predictor 既定）
    if (firstFixes + replacementFixes <= CELL_MIN_OPTIMIZE_COUNT) score = f32(score * CELL_DECAY)
    cells.push({ polygon: fixed, score, logic, cornerCounts: [firstFixes, replacementFixes] })
  }
  // 減衰後の信頼度で降順に並べ直す（同値は元の順序を保つ）
  return cells.map((c, i) => ({ c, i })).sort((a, b) => b.c.score - a.c.score || a.i - b.i).map((e) => e.c)
}

export interface Detection {
  /** 元画像（クロップ）座標の 4 角 */
  corners: Point[]
  score: number
  /** 1 始まり [start_col, end_col, start_row, end_row] */
  logic: [number, number, number, number]
}

/** 本家 polygon_overlap_nms（交差面積 / 小さい方の面積）。本家の既定では無効（use_nms=False） */
export function polygonOverlapNms(dets: Detection[], iouThresh: number): Detection[] {
  if (dets.length <= 1) return dets
  const areas = dets.map((d) => Math.abs(contourArea(d.corners)))
  const invalid = new Array<boolean>(dets.length).fill(false)
  for (let i = 0; i < dets.length; i++) {
    if (invalid[i]) continue
    for (let j = i + 1; j < dets.length; j++) {
      if (invalid[j]) continue
      const inter = convexIntersectionArea(dets[i].corners, dets[j].corners)
      const denom = Math.min(areas[i], areas[j])
      const overlap = denom > 0 ? inter / denom : 0
      if (overlap > iouThresh) {
        if (dets[i].score > dets[j].score) invalid[j] = true
        else { invalid[i] = true; break }
      }
    }
  }
  return dets.filter((_, i) => !invalid[i])
}

/** postprocess: しきい値で絞り、特徴マップ座標を逆アフィンで元画像座標へ */
export function postprocess(
  cells: DecodedCell[],
  inv: Affine,
  opts: { centerThresh?: number; useNms?: boolean; iouThresh?: number } = {}
): Detection[] {
  const thresh = opts.centerThresh ?? DEFAULT_CENTER_THRESH
  let dets: Detection[] = cells
    .filter((c) => c.score >= thresh)
    .map((c) => ({
      corners: c.polygon.map(([x, y]) => {
        const [u, v] = applyAffine(inv, x, y)
        return [f32(u), f32(v)] as Point
      }),
      score: c.score,
      logic: c.logic,
    }))
  if (opts.useNms) dets = polygonOverlapNms(dets, opts.iouThresh ?? DEFAULT_IOU_THRESH)
  return dets
}
