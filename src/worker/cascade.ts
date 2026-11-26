/**
 * カスケード文字認識（本家 ocr.py process_cascade 相当）
 *
 * 1. DEIM の文字数カテゴリで初段モデルを選ぶ（3: rec30, 2: rec50, その他: rec100）
 * 2. rec30 の結果が 25 文字以上なら rec50 で再認識
 * 3. rec50 の結果が 45 文字以上なら rec100 で再認識
 * 4. rec100 の結果が 98 文字以上かつ横長画像なら、左右に 2 分割して rec100 で認識し連結
 *
 * recognize 関数を注入する形にしており、
 *   - メインスレッド（認識 Worker プールへ分配）
 *   - ocr.worker（Worker 内のローカル認識）
 *   - テスト（Node 上で直接 ONNX 実行）
 * で共通に使う。
 */

import { splitHorizontalHalves, type RGBAImage } from './image-ops'
import { initialModelForCategory, type RecModelKey } from './recognizer-config'

export type RecognizeFn = (model: RecModelKey, image: RGBAImage) => Promise<string>

export interface CascadeLine {
  image: RGBAImage
  charCountCategory?: number
}

export interface CascadeOptions {
  /** false: 全行を rec100 で認識（本家 --simple-mode / モバイル） */
  useCategory?: boolean
}

/** 本家と同じ段上げ閾値 */
export const ESCALATE_FROM_30 = 25
export const ESCALATE_FROM_50 = 45
export const SPLIT_FROM_100 = 98

const len = (s: string) => Array.from(s).length

async function recognizeLine(line: CascadeLine, recognize: RecognizeFn, useCategory: boolean): Promise<string> {
  let model: RecModelKey = useCategory ? initialModelForCategory(line.charCountCategory) : 'recognition100'

  if (model === 'recognition30') {
    const text = await recognize('recognition30', line.image)
    if (len(text) < ESCALATE_FROM_30) return text
    model = 'recognition50'
  }
  if (model === 'recognition50') {
    const text = await recognize('recognition50', line.image)
    if (len(text) < ESCALATE_FROM_50) return text
  }

  const text = await recognize('recognition100', line.image)
  if (len(text) >= SPLIT_FROM_100 && line.image.height < line.image.width) {
    const [left, right] = splitHorizontalHalves(line.image)
    const [a, b] = await Promise.all([recognize('recognition100', left), recognize('recognition100', right)])
    return a + b
  }
  return text
}

export async function recognizeCascade(
  lines: CascadeLine[],
  recognize: RecognizeFn,
  options: CascadeOptions = {}
): Promise<string[]> {
  const { useCategory = true } = options
  return Promise.all(lines.map((line) => recognizeLine(line, recognize, useCategory)))
}

/** 同一セッションへの同時 run を避けるため、呼び出しを直列化する */
export function serialize(fn: RecognizeFn): RecognizeFn {
  let chain: Promise<unknown> = Promise.resolve()
  return (model, image) => {
    const next = chain.then(() => fn(model, image))
    chain = next.catch(() => undefined)
    return next
  }
}
