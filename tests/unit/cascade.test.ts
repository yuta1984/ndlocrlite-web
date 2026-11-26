import { describe, it, expect } from 'vitest'
import { recognizeCascade, serialize, type RecognizeFn } from '../../src/worker/cascade'
import { removeAsciiSpacesAroundJapanesePunctuation } from '../../src/worker/parseq-decode'
import { suppressOverlapping } from '../../src/worker/layout-detector'
import type { RGBAImage } from '../../src/worker/image-ops'

const img = (w: number, h: number): RGBAImage => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })
const chars = (n: number) => 'あ'.repeat(n)

/** モデルごとの返り値を指定できるフェイク認識器 */
function fake(outputs: Partial<Record<string, (image: RGBAImage) => string>>) {
  const calls: string[] = []
  const fn: RecognizeFn = async (model, image) => {
    calls.push(`${model}:${image.width}`)
    return outputs[model]?.(image) ?? ''
  }
  return { fn, calls }
}

describe('カスケード認識（本家 process_cascade 互換）', () => {
  it('カテゴリ 3 → rec30、2 → rec50、その他 → rec100', async () => {
    const { fn, calls } = fake({ recognition30: () => 'a', recognition50: () => 'b', recognition100: () => 'c' })
    const out = await recognizeCascade(
      [{ image: img(10, 5), charCountCategory: 3 }, { image: img(10, 5), charCountCategory: 2 }, { image: img(10, 5), charCountCategory: 1 }],
      fn
    )
    expect(out).toEqual(['a', 'b', 'c'])
    expect(calls.map((c) => c.split(':')[0])).toEqual(['recognition30', 'recognition50', 'recognition100'])
  })

  it('rec30 の結果が 25 文字以上なら rec50 → 45 文字以上なら rec100 へ段上げ', async () => {
    const { fn, calls } = fake({ recognition30: () => chars(25), recognition50: () => chars(45), recognition100: () => chars(60) })
    const [out] = await recognizeCascade([{ image: img(10, 5), charCountCategory: 3 }], fn)
    expect(out).toBe(chars(60))
    expect(calls.map((c) => c.split(':')[0])).toEqual(['recognition30', 'recognition50', 'recognition100'])
  })

  it('24 文字なら段上げしない', async () => {
    const { fn, calls } = fake({ recognition30: () => chars(24) })
    await recognizeCascade([{ image: img(10, 5), charCountCategory: 3 }], fn)
    expect(calls).toHaveLength(1)
  })

  it('rec100 で 98 文字以上かつ横長なら左右 2 分割して連結', async () => {
    const { fn, calls } = fake({ recognition100: (im) => (im.width === 100 ? chars(98) : im.width === 50 ? 'L' : 'R') })
    const [out] = await recognizeCascade([{ image: img(100, 10), charCountCategory: 1 }], fn)
    expect(out).toBe('LL') // 左右とも width 50 → 'L' + 'L'
    expect(calls).toEqual(['recognition100:100', 'recognition100:50', 'recognition100:50'])
  })

  it('縦長画像は 98 文字以上でも分割しない', async () => {
    const { fn, calls } = fake({ recognition100: () => chars(99) })
    await recognizeCascade([{ image: img(10, 100), charCountCategory: 1 }], fn)
    expect(calls).toHaveLength(1)
  })

  it('useCategory=false（モバイル）は全行 rec100', async () => {
    const { fn, calls } = fake({ recognition100: () => 'x' })
    await recognizeCascade([{ image: img(10, 5), charCountCategory: 3 }], fn, { useCategory: false })
    expect(calls).toEqual(['recognition100:10'])
  })

  it('serialize は同時実行を直列化する', async () => {
    let running = 0
    let maxRunning = 0
    const fn = serialize(async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return ''
    })
    await Promise.all([fn('recognition30', img(1, 1)), fn('recognition30', img(1, 1)), fn('recognition30', img(1, 1))])
    expect(maxRunning).toBe(1)
  })
})

describe('後処理', () => {
  it('「、」「。」前後の半角スペースを除去', () => {
    expect(removeAsciiSpacesAroundJapanesePunctuation('今日は 、晴れ 。 明日 。')).toBe('今日は、晴れ。明日。')
    expect(removeAsciiSpacesAroundJapanesePunctuation('Hello world')).toBe('Hello world')
  })

  it('同一クラスで大きい矩形に 90% 以上含まれる矩形を除去', () => {
    const dets = [
      { x: 0, y: 0, width: 100, height: 20, cls: 1 },
      { x: 5, y: 2, width: 50, height: 10, cls: 1 }, // 完全に内包 → 除去
      { x: 5, y: 2, width: 50, height: 10, cls: 2 }, // 別クラス → 残す
      { x: 90, y: 0, width: 50, height: 20, cls: 1 }, // 一部重なり → 残す
    ]
    const kept = suppressOverlapping(dets, 0.9, (d) => d.cls)
    expect(kept).toHaveLength(3)
    expect(kept).not.toContain(dets[1])
  })
})
