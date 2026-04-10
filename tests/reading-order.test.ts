/**
 * ReadingOrderProcessor テスト
 * XY-Cut アルゴリズムによる読み順推定の検証
 */

import { describe, it, expect } from 'vitest'
import { ReadingOrderProcessor } from '../src/worker/reading-order'
import type { TextBlock, PageBlock } from '../src/types/ocr'

function makeBlock(
  x: number, y: number, width: number, height: number,
  text: string, confidence = 0.9
): TextBlock {
  return { x, y, width, height, text, confidence, readingOrder: 0 }
}

const processor = new ReadingOrderProcessor()

// ============================================================
// 1. 基本ケース
// ============================================================
describe('ReadingOrderProcessor: basic', () => {
  it('空入力 → 空配列', () => {
    expect(processor.process([])).toEqual([])
  })

  it('単一ブロック → readingOrder=1', () => {
    const blocks = [makeBlock(10, 10, 100, 20, 'hello')]
    const result = processor.process(blocks)
    expect(result).toHaveLength(1)
    expect(result[0].readingOrder).toBe(1)
    expect(result[0].text).toBe('hello')
  })

  it('confidence が minConfidence 未満のブロックは除外', () => {
    const blocks = [
      makeBlock(10, 10, 100, 20, 'high', 0.9),
      makeBlock(10, 50, 100, 20, 'low', 0.05),
    ]
    const result = processor.process(blocks, undefined, { minConfidence: 0.1 })
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('high')
  })

  it('空テキストのブロックは除外', () => {
    const blocks = [
      makeBlock(10, 10, 100, 20, 'valid', 0.9),
      makeBlock(10, 50, 100, 20, '', 0.9),
      makeBlock(10, 90, 100, 20, '   ', 0.9),
    ]
    const result = processor.process(blocks)
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('valid')
  })
})

// ============================================================
// 2. 単一カラム（横書き）
// ============================================================
describe('ReadingOrderProcessor: single column horizontal', () => {
  it('上から下への横書きテキスト', () => {
    const blocks = [
      makeBlock(50, 100, 300, 30, 'line3'),  // 下
      makeBlock(50, 10, 300, 30, 'line1'),   // 上
      makeBlock(50, 55, 300, 30, 'line2'),   // 中
    ]
    const result = processor.process(blocks)
    expect(result.map(b => b.text)).toEqual(['line1', 'line2', 'line3'])
    expect(result.map(b => b.readingOrder)).toEqual([1, 2, 3])
  })
})

// ============================================================
// 3. 2段組レイアウト（横書き）
// ============================================================
describe('ReadingOrderProcessor: two-column horizontal', () => {
  it('左カラム→右カラムの順で読む', () => {
    // 左カラム: x=10, 右カラム: x=400 （間に大きなギャップ）
    const blocks = [
      makeBlock(400, 10, 300, 30, 'right1'),
      makeBlock(10, 10, 300, 30, 'left1'),
      makeBlock(400, 50, 300, 30, 'right2'),
      makeBlock(10, 50, 300, 30, 'left2'),
    ]
    const result = processor.process(blocks)
    // 左カラム全体 → 右カラム全体 の順を期待
    const texts = result.map(b => b.text)
    const leftIdx1 = texts.indexOf('left1')
    const leftIdx2 = texts.indexOf('left2')
    const rightIdx1 = texts.indexOf('right1')
    const rightIdx2 = texts.indexOf('right2')

    // 左カラムの行が右カラムより先
    expect(leftIdx1).toBeLessThan(rightIdx1)
    expect(leftIdx2).toBeLessThan(rightIdx2)
    // 各カラム内は上→下
    expect(leftIdx1).toBeLessThan(leftIdx2)
    expect(rightIdx1).toBeLessThan(rightIdx2)
  })
})

// ============================================================
// 4. 縦書きレイアウト
// ============================================================
describe('ReadingOrderProcessor: vertical text', () => {
  it('縦書きブロックは右→左の順で読む', () => {
    // 縦書き: width < height
    const blocks = [
      makeBlock(10, 10, 30, 300, 'col3'),   // 左端（最後に読む）
      makeBlock(200, 10, 30, 300, 'col1'),  // 右端（最初に読む）
      makeBlock(105, 10, 30, 300, 'col2'),  // 中央
    ]
    const result = processor.process(blocks)
    const texts = result.map(b => b.text)
    // 右→左の順
    expect(texts.indexOf('col1')).toBeLessThan(texts.indexOf('col2'))
    expect(texts.indexOf('col2')).toBeLessThan(texts.indexOf('col3'))
  })
})

// ============================================================
// 5. 見出し＋本文混合
// ============================================================
describe('ReadingOrderProcessor: mixed layout', () => {
  it('見出し（上部幅広）→ 本文（下部2カラム）', () => {
    // 見出し: ページ上部に全幅
    // 本文: 下半分に2カラム
    const blocks = [
      makeBlock(10, 10, 700, 40, 'title'),     // 見出し
      makeBlock(10, 100, 300, 30, 'body_left1'),
      makeBlock(10, 140, 300, 30, 'body_left2'),
      makeBlock(400, 100, 300, 30, 'body_right1'),
      makeBlock(400, 140, 300, 30, 'body_right2'),
    ]
    const result = processor.process(blocks)
    const texts = result.map(b => b.text)
    // 見出しが最初
    expect(texts[0]).toBe('title')
  })
})

// ============================================================
// 6. PageBlock（ブロック割り当て）を使った読み順
// ============================================================
describe('ReadingOrderProcessor: with PageBlocks', () => {
  it('ブロック割り当てモードで正しい読み順', () => {
    const textBlocks = [
      makeBlock(20, 20, 200, 30, 'A'),
      makeBlock(20, 60, 200, 30, 'B'),
      makeBlock(350, 20, 200, 30, 'C'),
      makeBlock(350, 60, 200, 30, 'D'),
    ]
    const pageBlocks: PageBlock[] = [
      { x: 0, y: 0, width: 300, height: 100 },    // 左ブロック
      { x: 320, y: 0, width: 300, height: 100 },   // 右ブロック
    ]
    const result = processor.process(textBlocks, pageBlocks)
    const texts = result.map(b => b.text)
    // 左ブロック → 右ブロック
    expect(texts.indexOf('A')).toBeLessThan(texts.indexOf('C'))
    expect(texts.indexOf('B')).toBeLessThan(texts.indexOf('D'))
  })

  it('割り当て率 < 70% → XY-Cut フォールバック', () => {
    const textBlocks = [
      makeBlock(20, 20, 200, 30, 'A'),
      makeBlock(500, 20, 200, 30, 'B'),  // ブロック外
      makeBlock(500, 60, 200, 30, 'C'),  // ブロック外
      makeBlock(500, 100, 200, 30, 'D'), // ブロック外
    ]
    const pageBlocks: PageBlock[] = [
      { x: 0, y: 0, width: 300, height: 100 }, // Aだけ入る = 25%
    ]
    const result = processor.process(textBlocks, pageBlocks)
    // フォールバックしても全ブロックが結果に含まれる
    expect(result).toHaveLength(4)
    expect(result.every(b => b.readingOrder > 0)).toBe(true)
  })
})

// ============================================================
// 7. readingOrder の連番性
// ============================================================
describe('ReadingOrderProcessor: readingOrder numbering', () => {
  it('readingOrder は 1 から連番', () => {
    const blocks = [
      makeBlock(10, 10, 100, 30, 'A'),
      makeBlock(10, 50, 100, 30, 'B'),
      makeBlock(10, 90, 100, 30, 'C'),
      makeBlock(10, 130, 100, 30, 'D'),
      makeBlock(10, 170, 100, 30, 'E'),
    ]
    const result = processor.process(blocks)
    const orders = result.map(b => b.readingOrder).sort((a, b) => a - b)
    expect(orders).toEqual([1, 2, 3, 4, 5])
  })
})
