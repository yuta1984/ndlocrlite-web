/**
 * 表構造認識（TableCenterNet）で使う OpenCV 相当の処理を純 TS で実装したもの
 *
 * Worker / Node（vitest）の双方で同じ結果になるよう Canvas は使わない。
 * 本家 ndlocr-lite v2.0.0 の tablecenternet.py が呼ぶ cv2 関数のうち必要なものだけを、
 * OpenCV の実装（8bit 画像の丸め・境界処理）に合わせて移植している。
 */

import type { RGBAImage } from '../image-ops'

export type Point = [number, number]
/** 2x3 アフィン行列（行優先 [a, b, c, d, e, f]: x' = a x + b y + c, y' = d x + e y + f） */
export type Affine = [number, number, number, number, number, number]

const f32 = Math.fround

/** Python の round()（偶数丸め） */
export function roundHalfEven(v: number): number {
  const r = Math.round(v)
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

// ---------------------------------------------------------------------------
// アフィン変換
// ---------------------------------------------------------------------------

/** cv2.getAffineTransform（3 点対応の連立方程式を倍精度で解く。入力は float32 に丸める） */
export function getAffineTransformFromPoints(src: Point[], dst: Point[]): Affine {
  // [x y 1 0 0 0; 0 0 0 x y 1] * [a b c d e f]^T = [u; v]
  const A: number[][] = []
  const B: number[] = []
  for (let i = 0; i < 3; i++) {
    const x = f32(src[i][0]), y = f32(src[i][1])
    A.push([x, y, 1, 0, 0, 0]); B.push(f32(dst[i][0]))
    A.push([0, 0, 0, x, y, 1]); B.push(f32(dst[i][1]))
  }
  // ガウスの消去法（部分ピボット選択）
  const n = 6
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (A[piv][col] === 0) throw new Error('getAffineTransform: degenerate points')
    ;[A[col], A[piv]] = [A[piv], A[col]]
    ;[B[col], B[piv]] = [B[piv], B[col]]
    for (let r = col + 1; r < n; r++) {
      const k = A[r][col] / A[col][col]
      if (k === 0) continue
      for (let c = col; c < n; c++) A[r][c] -= k * A[col][c]
      B[r] -= k * B[col]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = B[r]
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c]
    x[r] = s / A[r][r]
  }
  return x as Affine
}

/**
 * TableCenterNet（CenterNet 系）の get_affine_transform（rot = 0）
 * center を中心とする scale × scale の正方形を outW × outH へ写す
 */
export function getCenterAffine(center: Point, scale: number, outW: number, outH: number, inv = false): Affine {
  const srcW = f32(scale)
  const c: Point = [f32(center[0]), f32(center[1])]
  const srcDir: Point = [0, f32(-0.5 * srcW)]
  const dstDir: Point = [0, f32(-0.5 * outW)]
  const third = (a: Point, b: Point): Point => {
    const d: Point = [f32(a[0] - b[0]), f32(a[1] - b[1])]
    return [f32(b[0] - d[1]), f32(b[1] + d[0])]
  }
  const s0 = c
  const s1: Point = [f32(c[0] + srcDir[0]), f32(c[1] + srcDir[1])]
  const s2 = third(s0, s1)
  const d0: Point = [f32(0.5 * outW), f32(0.5 * outH)]
  const d1: Point = [f32(d0[0] + dstDir[0]), f32(d0[1] + dstDir[1])]
  const d2 = third(d0, d1)
  return inv
    ? getAffineTransformFromPoints([d0, d1, d2], [s0, s1, s2])
    : getAffineTransformFromPoints([s0, s1, s2], [d0, d1, d2])
}

export function applyAffine(m: Affine, x: number, y: number): Point {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]
}

function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m
  let det = a * e - b * d
  det = det !== 0 ? 1 / det : 0
  const A11 = e * det, A22 = a * det, A12 = -b * det, A21 = -d * det
  return [A11, A12, -A11 * c - A12 * f, A21, A22, -A21 * c - A22 * f]
}

/**
 * cv2.warpAffine(INTER_LINEAR, BORDER_CONSTANT=0) を RGBA 入力に対して行い、
 * BGR 3ch の uint8（HWC）を返す（本家は BGR 画像に対してワープする）。
 *
 * OpenCV 4.11 以降の浮動小数点実装（warp_kernels）に合わせる:
 *   逆行列の係数を float32 にし、座標は高精度で計算して float32 に丸め、
 *   補間は float32 で x 方向→y 方向の順、最後に偶数丸め。範囲外の近傍画素は 0。
 * （tests/unit/table-cv-ops.test.ts で opencv-python の出力とビット一致を確認）
 */
export function warpAffineLinearBGR(img: RGBAImage, m: Affine, dw: number, dh: number): Uint8Array {
  const { data, width: sw, height: sh } = img
  const out = new Uint8Array(dw * dh * 3)
  const M = invertAffine(m).map(f32)
  const px = (x: number, y: number, ch: number) =>
    x >= 0 && y >= 0 && x < sw && y < sh ? data[(y * sw + x) * 4 + ch] : 0
  for (let y = 0; y < dh; y++) {
    const bx = M[1] * y + M[2]
    const by = M[4] * y + M[5]
    for (let x = 0; x < dw; x++) {
      const sx = f32(M[0] * x + bx)
      const sy = f32(M[3] * x + by)
      const ix = Math.floor(sx)
      const iy = Math.floor(sy)
      if (ix >= sw || ix + 1 < 0 || iy >= sh || iy + 1 < 0) continue // 0 のまま
      const al = f32(sx - ix)
      const be = f32(sy - iy)
      const o = (y * dw + x) * 3
      const inside = ix >= 0 && iy >= 0 && ix + 1 < sw && iy + 1 < sh
      for (let ch = 0; ch < 3; ch++) {
        const sc = 2 - ch // RGBA → BGR
        let p00: number, p01: number, p10: number, p11: number
        if (inside) {
          const i0 = (iy * sw + ix) * 4 + sc
          const i1 = i0 + sw * 4
          p00 = data[i0]; p01 = data[i0 + 4]; p10 = data[i1]; p11 = data[i1 + 4]
        } else {
          p00 = px(ix, iy, sc); p01 = px(ix + 1, iy, sc); p10 = px(ix, iy + 1, sc); p11 = px(ix + 1, iy + 1, sc)
        }
        const t = f32(p00 + f32(al * (p01 - p00)))
        const b = f32(p10 + f32(al * (p11 - p10)))
        const v = roundHalfEven(f32(t + f32(be * f32(b - t))))
        out[o + ch] = v < 0 ? 0 : v > 255 ? 255 : v
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 2 値化・モルフォロジー
// ---------------------------------------------------------------------------

export interface GrayImage {
  data: Uint8Array
  width: number
  height: number
}

/** 矩形を切り出して cv2.cvtColor(RGB2GRAY) する（固定小数点: (4899R + 9617G + 1868B + 8192) >> 14） */
export function rgbaToGray(img: RGBAImage, x0 = 0, y0 = 0, w = img.width, h = img.height): GrayImage {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    let si = ((y + y0) * img.width + x0) * 4
    for (let x = 0; x < w; x++, si += 4) {
      out[y * w + x] = (img.data[si] * 4899 + img.data[si + 1] * 9617 + img.data[si + 2] * 1868 + 8192) >> 14
    }
  }
  return { data: out, width: w, height: h }
}

/**
 * cv2.adaptiveThreshold(gray, 255, ADAPTIVE_THRESH_MEAN_C, THRESH_BINARY_INV, block, C)
 * 平均は boxFilter(BORDER_REPLICATE) の結果を uint8 に丸めたもの。
 * 出力: src - mean <= -floor(C) なら 255、それ以外 0
 */
export function adaptiveThresholdMeanInv(src: GrayImage, block: number, C: number): GrayImage {
  const { data, width: w, height: h } = src
  const r = block >> 1
  const idelta = Math.floor(C)
  const clampX = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x)
  const clampY = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y)
  // 水平方向の窓和（境界は複製）
  const hsum = new Int32Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let s = 0
    for (let k = -r; k <= r; k++) s += data[row + clampX(k)]
    hsum[row] = s
    for (let x = 1; x < w; x++) {
      s += data[row + clampX(x + r)] - data[row + clampX(x - r - 1)]
      hsum[row + x] = s
    }
  }
  const out = new Uint8Array(w * h)
  const scale = 1 / (block * block)
  const col = new Int32Array(w)
  for (let k = -r; k <= r; k++) {
    const row = clampY(k) * w
    for (let x = 0; x < w; x++) col[x] += hsum[row + x]
  }
  for (let y = 0; y < h; y++) {
    if (y > 0) {
      const add = clampY(y + r) * w
      const sub = clampY(y - r - 1) * w
      for (let x = 0; x < w; x++) col[x] += hsum[add + x] - hsum[sub + x]
    }
    for (let x = 0; x < w; x++) {
      const mean = Math.round(col[x] * scale)
      out[y * w + x] = data[y * w + x] - mean <= -idelta ? 255 : 0
    }
  }
  return { data: out, width: w, height: h }
}

/**
 * 2 値画像（0/非 0）の 1 次元方向の erode / dilate（OpenCV と同じアンカー = floor(k/2)、
 * 範囲外は erode では無視・dilate では 0 扱い）
 */
function morph1D(src: Uint8Array, w: number, h: number, k: number, horizontal: boolean, erode: boolean): Uint8Array {
  const out = new Uint8Array(w * h)
  const a = k >> 1
  const len = horizontal ? w : h
  const lines = horizontal ? h : w
  const prefix = new Int32Array(len + 1)
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < len; i++) {
      const idx = horizontal ? l * w + i : i * w + l
      prefix[i + 1] = prefix[i] + (src[idx] ? 1 : 0)
    }
    for (let i = 0; i < len; i++) {
      const lo = Math.max(0, i - a)
      const hi = Math.min(len, i - a + k)
      const cnt = hi > lo ? prefix[hi] - prefix[lo] : 0
      const v = erode ? cnt === hi - lo : cnt > 0
      if (v) out[horizontal ? l * w + i : i * w + l] = 255
    }
  }
  return out
}

/** cv2.morphologyEx(MORPH_OPEN, getStructuringElement(MORPH_RECT, (kw, kh)))（kw または kh が 1） */
export function morphOpenRect(src: GrayImage, kw: number, kh: number): GrayImage {
  const { width: w, height: h } = src
  let d = src.data
  if (kw > 1 && kh > 1) throw new Error('morphOpenRect: only 1-D kernels are supported')
  if (kw > 1) {
    d = morph1D(d, w, h, kw, true, true)
    d = morph1D(d, w, h, kw, true, false)
  } else if (kh > 1) {
    d = morph1D(d, w, h, kh, false, true)
    d = morph1D(d, w, h, kh, false, false)
  } else {
    d = Uint8Array.from(d)
  }
  return { data: d, width: w, height: h }
}

// ---------------------------------------------------------------------------
// 幾何
// ---------------------------------------------------------------------------

/** cv2.contourArea（符号付き面積の絶対値ではなく符号付きを返す） */
export function contourArea(poly: Point[]): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]
  }
  return a / 2
}

/** cv2.pointPolygonTest(contour, pt, measureDist=False): +1 内部 / 0 境界 / -1 外部 */
export function pointPolygonTest(contour: Point[], x: number, y: number): number {
  const ipx = f32(x), ipy = f32(y)
  const total = contour.length
  if (total === 0) return -1
  let counter = 0
  let v = contour[total - 1]
  for (let i = 0; i < total; i++) {
    const v0 = v
    v = contour[i]
    if ((v0[1] <= ipy && v[1] <= ipy) || (v0[1] > ipy && v[1] > ipy) || (v0[0] < ipx && v[0] < ipx)) {
      if (ipy === v[1] && (ipx === v[0] || (ipy === v0[1] && ((v0[0] <= ipx && ipx <= v[0]) || (v[0] <= ipx && ipx <= v0[0]))))) {
        return 0
      }
      continue
    }
    let dist = (ipy - v0[1]) * (v[0] - v0[0]) - (ipx - v0[0]) * (v[1] - v0[1])
    if (dist === 0) return 0
    if (v[1] < v0[1]) dist = -dist
    if (dist > 0) counter++
  }
  return counter % 2 === 0 ? -1 : 1
}

/**
 * 2 つの凸多角形の交差面積（cv2.intersectConvexConvex の面積に相当）
 * Sutherland–Hodgman 法でクリップする（入れ子の場合も内側の多角形がそのまま残る）
 */
export function convexIntersectionArea(a: Point[], b: Point[]): number {
  if (a.length < 3 || b.length < 3) return 0
  // クリップ側は反時計回り（数学座標で正の面積）にそろえる
  const clip = contourArea(b) < 0 ? [...b].reverse() : b
  let poly: Point[] = a
  for (let i = 0; i < clip.length && poly.length > 0; i++) {
    const p = clip[i]
    const q = clip[(i + 1) % clip.length]
    const side = (pt: Point) => (q[0] - p[0]) * (pt[1] - p[1]) - (q[1] - p[1]) * (pt[0] - p[0])
    const next: Point[] = []
    for (let j = 0; j < poly.length; j++) {
      const cur = poly[j]
      const prev = poly[(j + poly.length - 1) % poly.length]
      const sc = side(cur)
      const sp = side(prev)
      if (sc >= 0) {
        if (sp < 0) next.push(intersect(prev, cur, sp, sc))
        next.push(cur)
      } else if (sp >= 0) {
        next.push(intersect(prev, cur, sp, sc))
      }
    }
    poly = next
  }
  return poly.length >= 3 ? Math.abs(contourArea(poly)) : 0
}

function intersect(p: Point, q: Point, sp: number, sq: number): Point {
  const t = sp / (sp - sq)
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
}
