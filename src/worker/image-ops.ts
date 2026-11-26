/**
 * Canvas 非依存の画像処理ユーティリティ（RGBA バッファを直接操作）
 *
 * - Worker / Node（テスト）のどちらでも同じ結果になるよう、OffscreenCanvas を使わない
 * - リサイズは本家 ndlocr-lite の前処理に合わせる
 *     レイアウト(DEIM): PIL Image.resize (bicubic + antialias)
 *     文字認識(PARSeq): cv2.resize INTER_LINEAR
 */

export interface RGBAImage {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

/** 矩形領域を切り出す（範囲外はクリップ） */
export function cropRGBA(img: RGBAImage, x: number, y: number, w: number, h: number): RGBAImage {
  const x0 = Math.max(0, Math.min(img.width, Math.round(x)))
  const y0 = Math.max(0, Math.min(img.height, Math.round(y)))
  const x1 = Math.max(x0, Math.min(img.width, Math.round(x + w)))
  const y1 = Math.max(y0, Math.min(img.height, Math.round(y + h)))
  const cw = x1 - x0
  const ch = y1 - y0
  const out = new Uint8ClampedArray(cw * ch * 4)
  for (let row = 0; row < ch; row++) {
    const srcStart = ((y0 + row) * img.width + x0) * 4
    out.set(img.data.subarray(srcStart, srcStart + cw * 4), row * cw * 4)
  }
  return { data: out, width: cw, height: ch }
}

/** 左右に分割（本家 process_cascade の 98 文字超え行の 2 分割用） */
export function splitHorizontalHalves(img: RGBAImage): [RGBAImage, RGBAImage] {
  const half = Math.floor(img.width / 2)
  return [
    cropRGBA(img, 0, 0, half, img.height),
    cropRGBA(img, half, 0, img.width - half, img.height),
  ]
}

/** 反時計回りに 90 度回転（cv2.ROTATE_90_COUNTERCLOCKWISE と同じ） */
export function rotate90CCW(img: RGBAImage): RGBAImage {
  const { width: w, height: h, data } = img
  const out = new Uint8ClampedArray(w * h * 4)
  // 出力サイズ: width = h, height = w
  // dst(x', y') = src(x = w - 1 - y', y = x')
  for (let yd = 0; yd < w; yd++) {
    const xs = w - 1 - yd
    for (let xd = 0; xd < h; xd++) {
      const si = (xd * w + xs) * 4
      const di = (yd * h + xd) * 4
      out[di] = data[si]
      out[di + 1] = data[si + 1]
      out[di + 2] = data[si + 2]
      out[di + 3] = data[si + 3]
    }
  }
  return { data: out, width: h, height: w }
}

/**
 * cv2.resize(INTER_LINEAR) 互換の双線形補間（アンチエイリアスなし）
 * 出力は RGB 3ch の Float32（0-255）を HWC で返す
 */
export function resizeBilinearRGB(img: RGBAImage, dw: number, dh: number): Float32Array {
  const { width: sw, height: sh, data } = img
  const out = new Float32Array(dw * dh * 3)
  const sx = sw / dw
  const sy = sh / dh

  const x0s = new Int32Array(dw)
  const x1s = new Int32Array(dw)
  const fxs = new Float32Array(dw)
  for (let x = 0; x < dw; x++) {
    let fx = (x + 0.5) * sx - 0.5
    let ix = Math.floor(fx)
    fx -= ix
    if (ix < 0) { ix = 0; fx = 0 }
    if (ix >= sw - 1) { ix = sw - 1; fx = 0 }
    x0s[x] = ix
    x1s[x] = Math.min(ix + 1, sw - 1)
    fxs[x] = fx
  }

  for (let y = 0; y < dh; y++) {
    let fy = (y + 0.5) * sy - 0.5
    let iy = Math.floor(fy)
    fy -= iy
    if (iy < 0) { iy = 0; fy = 0 }
    if (iy >= sh - 1) { iy = sh - 1; fy = 0 }
    const iy1 = Math.min(iy + 1, sh - 1)
    const r0 = iy * sw
    const r1 = iy1 * sw
    for (let x = 0; x < dw; x++) {
      const fx = fxs[x]
      const a = (r0 + x0s[x]) * 4
      const b = (r0 + x1s[x]) * 4
      const c = (r1 + x0s[x]) * 4
      const d = (r1 + x1s[x]) * 4
      const o = (y * dw + x) * 3
      for (let ch = 0; ch < 3; ch++) {
        const top = data[a + ch] + (data[b + ch] - data[a + ch]) * fx
        const bot = data[c + ch] + (data[d + ch] - data[c + ch]) * fx
        // cv2 は uint8 画像に対して uint8 で出力するため丸める
        out[o + ch] = Math.round(top + (bot - top) * fy)
      }
    }
  }
  return out
}

// --- PIL 互換 bicubic（antialias 付き）リサンプリング -------------------------

function bicubicFilter(x: number): number {
  // PIL: a = -0.5
  const a = -0.5
  if (x < 0) x = -x
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a
  return 0
}

interface Coeffs {
  bounds: Int32Array // [min, size] * outSize
  weights: Float32Array // ksize * outSize
  ksize: number
}

/** PIL ImagingResample の precompute_coeffs 相当 */
function precomputeCoeffs(inSize: number, outSize: number): Coeffs {
  const support0 = 2 // bicubic
  const scale = inSize / outSize
  const filterscale = Math.max(1, scale)
  const support = support0 * filterscale
  const ksize = Math.ceil(support) * 2 + 1
  const bounds = new Int32Array(outSize * 2)
  const weights = new Float32Array(outSize * ksize)
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale
    const ss = 1 / filterscale
    let xmin = Math.floor(center - support + 0.5)
    if (xmin < 0) xmin = 0
    let xmax = Math.floor(center + support + 0.5)
    if (xmax > inSize) xmax = inSize
    xmax -= xmin
    let ww = 0
    for (let x = 0; x < xmax; x++) {
      const w = bicubicFilter((x + xmin - center + 0.5) * ss)
      weights[xx * ksize + x] = w
      ww += w
    }
    if (ww !== 0) {
      for (let x = 0; x < xmax; x++) weights[xx * ksize + x] /= ww
    }
    bounds[xx * 2] = xmin
    bounds[xx * 2 + 1] = xmax
  }
  return { bounds, weights, ksize }
}

/**
 * 画像を (side × side) の正方形に黒でパディングしてから (outSize × outSize) へ
 * PIL Image.resize(BICUBIC) 互換でリサイズする。本家 deim.py の preprocess と同じ。
 * 戻り値: RGB 3ch Uint8 (HWC)
 */
export function padSquareResizePIL(img: RGBAImage, outSize: number): Uint8ClampedArray {
  const side = Math.max(img.width, img.height)
  const cx = precomputeCoeffs(side, outSize)
  const cy = precomputeCoeffs(side, outSize)

  // 1) 水平方向: side 行のうち実画像のある行だけ計算（パディング行は 0）
  //    PIL は各パスの結果を uint8 に丸めるため同様に丸める
  const tmp = new Uint8ClampedArray(img.height * outSize * 3)
  const { data, width: sw } = img
  for (let y = 0; y < img.height; y++) {
    const row = y * sw
    for (let xx = 0; xx < outSize; xx++) {
      const xmin = cx.bounds[xx * 2]
      const xmax = cx.bounds[xx * 2 + 1]
      const wbase = xx * cx.ksize
      let r = 0, g = 0, b = 0
      for (let x = 0; x < xmax; x++) {
        const sx = xmin + x
        if (sx >= sw) break // パディング領域は 0
        const w = cx.weights[wbase + x]
        const si = (row + sx) * 4
        r += data[si] * w
        g += data[si + 1] * w
        b += data[si + 2] * w
      }
      const o = (y * outSize + xx) * 3
      tmp[o] = Math.round(r)
      tmp[o + 1] = Math.round(g)
      tmp[o + 2] = Math.round(b)
    }
  }

  // 2) 垂直方向
  const out = new Uint8ClampedArray(outSize * outSize * 3)
  for (let yy = 0; yy < outSize; yy++) {
    const ymin = cy.bounds[yy * 2]
    const ymax = cy.bounds[yy * 2 + 1]
    const wbase = yy * cy.ksize
    for (let xx = 0; xx < outSize; xx++) {
      let r = 0, g = 0, b = 0
      for (let y = 0; y < ymax; y++) {
        const sy = ymin + y
        if (sy >= img.height) break
        const w = cy.weights[wbase + y]
        const si = (sy * outSize + xx) * 3
        r += tmp[si] * w
        g += tmp[si + 1] * w
        b += tmp[si + 2] * w
      }
      const o = (yy * outSize + xx) * 3
      out[o] = Math.round(r)
      out[o + 1] = Math.round(g)
      out[o + 2] = Math.round(b)
    }
  }
  return out
}

/**
 * 画像を左上に置き、指定サイズまで白で余白を付ける（元画像は縮小しない）
 * 領域 OCR 用: 小さな切り出し画像をそのままレイアウト認識に掛けると 800px へ大きく拡大され、
 * 文字が学習時（ページ全体）より極端に大きくなって検出が崩れるため、元ページと同じ縮尺を保つ
 */
export function padToSize(img: RGBAImage, width: number, height: number): RGBAImage {
  const W = Math.max(width, img.width)
  const H = Math.max(height, img.height)
  if (W === img.width && H === img.height) return img
  const out = new Uint8ClampedArray(W * H * 4).fill(255)
  for (let y = 0; y < img.height; y++) {
    out.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), y * W * 4)
  }
  return { data: out, width: W, height: H }
}
