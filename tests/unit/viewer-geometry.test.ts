import { describe, it, expect } from 'vitest'
import { normalizeRect, isValidRegion, blocksInRect, hitTest } from '../../src/components/viewer/viewer-geometry'
import type { TextBlock } from '../../src/types/ocr'

const line = (x: number, y: number, w: number, h: number, text = ''): TextBlock => ({
  x, y, width: w, height: h, confidence: 1, classId: 1, text, readingOrder: 0,
})

describe('ビューアの幾何計算', () => {
  it('normalizeRect: 逆方向のドラッグでも正の矩形になり、画像範囲にクリップされる', () => {
    expect(normalizeRect({ x: 120, y: 80 }, { x: 20, y: 10 }, 1000, 1000)).toEqual({ x: 20, y: 10, width: 100, height: 70 })
    expect(normalizeRect({ x: -50, y: -10 }, { x: 2000, y: 30 }, 800, 600)).toEqual({ x: 0, y: 0, width: 800, height: 30 })
  })

  it('isValidRegion: 15px 未満は無効（クリックと区別）', () => {
    expect(isValidRegion({ x: 0, y: 0, width: 14, height: 100 })).toBe(false)
    expect(isValidRegion({ x: 0, y: 0, width: 15, height: 15 })).toBe(true)
  })

  it('blocksInRect: 矩形と重なる行を返す', () => {
    const a = line(0, 0, 10, 10, 'a')
    const b = line(50, 50, 10, 10, 'b')
    expect(blocksInRect({ x: 5, y: 5, width: 10, height: 10 }, [a, b])).toEqual([a])
  })

  it('hitTest: 行を優先し、重なりは小さい方。行が無ければブロック', () => {
    const big = line(0, 0, 100, 100, 'big')
    const small = line(10, 10, 20, 20, 'small')
    expect(hitTest({ x: 15, y: 15 }, [big, small])).toEqual({ kind: 'line', block: small })
    const pb = { x: 200, y: 200, width: 50, height: 50 }
    expect(hitTest({ x: 210, y: 210 }, [big], [pb])).toEqual({ kind: 'page', block: pb })
    expect(hitTest({ x: 500, y: 500 }, [big], [pb])).toBeNull()
  })
})
