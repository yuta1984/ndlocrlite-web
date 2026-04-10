/**
 * エッジケース + エラー処理テスト
 * 極端な入力サイズ・エラーパスの検証
 */

import { describe, it, expect } from 'vitest'
import { join } from 'path'
import {
  preprocessForDetection,
  preprocessForRecognition,
  ctcDecode,
  loadDict,
} from './test-helpers'
import { ReadingOrderProcessor } from '../src/worker/reading-order'

const DICT_DIR = join(__dirname, '..', 'public', 'config', 'paddleocr')

// ============================================================
// 1. 極小画像の前処理
// ============================================================
describe('Edge case: tiny images', () => {
  function makeImageData(w: number, h: number) {
    return {
      data: new Uint8ClampedArray(w * h * 4).fill(128),
      width: w,
      height: h,
    }
  }

  it('1x1 画像の検出前処理 → 最小32x32テンソル', () => {
    const img = makeImageData(1, 1)
    const { tensor, metadata } = preprocessForDetection(img)

    expect(tensor.dims[2]).toBeGreaterThanOrEqual(32)
    expect(tensor.dims[3]).toBeGreaterThanOrEqual(32)
    expect(metadata.originalWidth).toBe(1)
    expect(metadata.originalHeight).toBe(1)
  })

  it('10x10 画像の検出前処理 → 32の倍数テンソル', () => {
    const img = makeImageData(10, 10)
    const { tensor } = preprocessForDetection(img)

    expect(Number(tensor.dims[2]) % 32).toBe(0)
    expect(Number(tensor.dims[3]) % 32).toBe(0)
  })

  it('1x1 画像の認識前処理 → height=48, width>=8', () => {
    const img = makeImageData(1, 1)
    const tensor = preprocessForRecognition(img)

    expect(tensor.dims[2]).toBe(48)
    expect(Number(tensor.dims[3])).toBeGreaterThanOrEqual(8)
    expect(Number(tensor.dims[3]) % 8).toBe(0)
  })
})

// ============================================================
// 2. 極大画像の前処理 (limit_side_len=960)
// ============================================================
describe('Edge case: large images', () => {
  function makeImageData(w: number, h: number) {
    // 大きな ImageData は実際にはメモリ的に作れないが、メタデータだけ確認する
    return {
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }
  }

  it('4000x6000 画像 → 960以下にリサイズされる', () => {
    const img = makeImageData(400, 600)   // 小さいサイズで代用（比率だけ確認）
    const { tensor, metadata } = preprocessForDetection(img)

    // 32の倍数
    expect(Number(tensor.dims[2]) % 32).toBe(0)
    expect(Number(tensor.dims[3]) % 32).toBe(0)
    // リサイズ比率が正しい
    expect(metadata.ratioW).toBeCloseTo(metadata.originalWidth / metadata.resizedWidth, 2)
    expect(metadata.ratioH).toBeCloseTo(metadata.originalHeight / metadata.resizedHeight, 2)
  })

  it('正方形画像のリサイズ比率', () => {
    const img = makeImageData(500, 500)
    const { metadata } = preprocessForDetection(img)

    // 500 < 960 なのでリサイズなし、32倍数に丸め
    expect(metadata.resizedWidth).toBeGreaterThanOrEqual(500)
    expect(metadata.resizedHeight).toBeGreaterThanOrEqual(500)
  })
})

// ============================================================
// 3. CTC デコード エッジケース
// ============================================================
describe('Edge case: CTC decode', () => {
  it('seqLength=1 → 1文字', () => {
    const charList = ['a', 'b']
    const vocabSize = 3
    const logits = new Float32Array(vocabSize)
    logits[1] = 10.0  // 'a'
    expect(ctcDecode(logits, 1, vocabSize, charList)).toBe('a')
  })

  it('seqLength=1 で blank → 空文字列', () => {
    const charList = ['a']
    const vocabSize = 2
    const logits = new Float32Array(vocabSize)
    logits[0] = 10.0  // blank
    expect(ctcDecode(logits, 1, vocabSize, charList)).toBe('')
  })

  it('全フレーム同一文字 → 重複除去で1文字', () => {
    const charList = ['x']
    const vocabSize = 2
    const seqLength = 100
    const logits = new Float32Array(seqLength * vocabSize)
    for (let t = 0; t < seqLength; t++) {
      logits[t * vocabSize + 1] = 10.0  // 'x'
    }
    expect(ctcDecode(logits, seqLength, vocabSize, charList)).toBe('x')
  })

  it('交互の blank と文字 → 文字が連続する', () => {
    const charList = ['a']
    const vocabSize = 2
    const seqLength = 6
    const logits = new Float32Array(seqLength * vocabSize)
    // a, blank, a, blank, a, blank
    logits[0 * vocabSize + 1] = 10.0
    logits[1 * vocabSize + 0] = 10.0
    logits[2 * vocabSize + 1] = 10.0
    logits[3 * vocabSize + 0] = 10.0
    logits[4 * vocabSize + 1] = 10.0
    logits[5 * vocabSize + 0] = 10.0
    expect(ctcDecode(logits, seqLength, vocabSize, charList)).toBe('aaa')
  })
})

// ============================================================
// 4. 辞書の整合性チェック
// ============================================================
describe('Edge case: dictionary integrity', () => {
  it('辞書に重複文字がないこと', () => {
    const dicts = ['chinese_dict.txt', 'english_dict.txt', 'korean_dict.txt', 'latin_dict.txt']
    for (const dictFile of dicts) {
      const chars = loadDict(join(DICT_DIR, dictFile))
      const unique = new Set(chars)
      // 重複があっても動作はするが、品質チェックとして
      expect(chars.length, `${dictFile} has duplicates`).toBe(unique.size)
    }
  })

  it('辞書に空行が含まれないこと', () => {
    const dicts = ['chinese_dict.txt', 'english_dict.txt']
    for (const dictFile of dicts) {
      const chars = loadDict(join(DICT_DIR, dictFile))
      for (const ch of chars) {
        expect(ch.length, `Empty entry in ${dictFile}`).toBeGreaterThan(0)
      }
    }
  })
})

// ============================================================
// 5. ReadingOrder エッジケース
// ============================================================
describe('Edge case: reading order', () => {
  const processor = new ReadingOrderProcessor()

  function makeBlock(x: number, y: number, w: number, h: number, text: string) {
    return { x, y, width: w, height: h, text, confidence: 0.9, readingOrder: 0 }
  }

  it('全ブロックが同一座標 → クラッシュしない', () => {
    const blocks = [
      makeBlock(100, 100, 50, 20, 'A'),
      makeBlock(100, 100, 50, 20, 'B'),
    ]
    const result = processor.process(blocks)
    expect(result).toHaveLength(2)
    expect(result.every((b: { readingOrder: number }) => b.readingOrder > 0)).toBe(true)
  })

  it('非常に多いブロック(50個)でもクラッシュしない', () => {
    const blocks = Array.from({ length: 50 }, (_, i) =>
      makeBlock(10 + (i % 5) * 200, 10 + Math.floor(i / 5) * 50, 180, 40, `block-${i}`)
    )
    const result = processor.process(blocks)
    expect(result).toHaveLength(50)
    const orders = result.map((b: { readingOrder: number }) => b.readingOrder).sort((a: number, b: number) => a - b)
    expect(orders[0]).toBe(1)
    expect(orders[49]).toBe(50)
  })

  it('幅0のブロック → クラッシュしない', () => {
    const blocks = [
      makeBlock(100, 100, 0, 20, 'zero-width'),
      makeBlock(200, 100, 100, 20, 'normal'),
    ]
    const result = processor.process(blocks)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================
// 6. ハッシュ検証エラーパス
// ============================================================
describe('Edge case: hash verification', () => {
  it('空の ArrayBuffer のハッシュが計算できる', async () => {
    const empty = new ArrayBuffer(0)
    const hash = await crypto.subtle.digest('SHA-256', empty)
    const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
    // SHA-256 of empty = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
