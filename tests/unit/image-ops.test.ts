import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cropRGBA, rotate90CCW, resizeBilinearRGB, padSquareResizePIL, splitHorizontalHalves } from '../../src/worker/image-ops'
import { FIXTURES, loadImage } from '../helpers'

function make(w: number, h: number, f: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = f(x, y)
    data.set([v, v, v, 255], (y * w + x) * 4)
  }
  return { data, width: w, height: h }
}

describe('image-ops', () => {
  it('cropRGBA は範囲をクリップして切り出す', () => {
    const img = make(4, 3, (x, y) => y * 10 + x)
    const c = cropRGBA(img, 1, 1, 10, 10)
    expect([c.width, c.height]).toEqual([3, 2])
    expect(c.data[0]).toBe(11)
  })

  it('rotate90CCW は cv2.ROTATE_90_COUNTERCLOCKWISE と同じ', () => {
    // [[0,1,2],[10,11,12]] → [[2,12],[1,11],[0,10]]
    const img = make(3, 2, (x, y) => y * 10 + x)
    const r = rotate90CCW(img)
    expect([r.width, r.height]).toEqual([2, 3])
    const px = (x: number, y: number) => r.data[(y * r.width + x) * 4]
    expect([px(0, 0), px(1, 0), px(0, 1), px(1, 1), px(0, 2), px(1, 2)]).toEqual([2, 12, 1, 11, 0, 10])
  })

  it('resizeBilinearRGB: 同一サイズでは値が変わらない', () => {
    const img = make(5, 4, (x, y) => x * 20 + y)
    const out = resizeBilinearRGB(img, 5, 4)
    expect(out[3 * (2 * 5 + 3)]).toBe(3 * 20 + 2)
  })

  it('splitHorizontalHalves は左右に分割', () => {
    const [a, b] = splitHorizontalHalves(make(5, 2, (x) => x))
    expect([a.width, b.width]).toEqual([2, 3])
  })

  it('padSquareResizePIL は PIL Image.resize(bicubic) とほぼ一致する', () => {
    const ref = path.join(FIXTURES, 'pil_resize', 'kumonoito_800.png')
    if (!fs.existsSync(ref)) return
    const src = loadImage(path.join(FIXTURES, 'images', 'kumonoito.png'))
    const out = padSquareResizePIL(src, 800)
    const expected = loadImage(ref)
    let maxDiff = 0
    let sum = 0
    for (let i = 0; i < 800 * 800; i++) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(out[i * 3 + c] - expected.data[i * 4 + c])
        maxDiff = Math.max(maxDiff, d)
        sum += d
      }
    }
    expect(sum / (800 * 800 * 3)).toBeLessThan(0.5)
    expect(maxDiff).toBeLessThanOrEqual(3)
  })
})

describe('padToSize（領域OCR用の余白付け）', () => {
  it('左上に元画像を置き、残りを白で埋める。縮小はしない', async () => {
    const { padToSize } = await import('../../src/worker/image-ops')
    const src = { data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]), width: 2, height: 1 }
    const out = padToSize(src, 3, 2)
    expect([out.width, out.height]).toEqual([3, 2])
    expect(Array.from(out.data.slice(0, 8))).toEqual([10, 20, 30, 255, 40, 50, 60, 255])
    expect(Array.from(out.data.slice(8, 12))).toEqual([255, 255, 255, 255])
    expect(padToSize(src, 1, 1)).toBe(src)
  })
})
