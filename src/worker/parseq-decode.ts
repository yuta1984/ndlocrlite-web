/**
 * PARSeq 出力のデコード（本家 ndlocr-lite/src/parseq.py の read() と同じ処理）
 *
 * - 各位置で argmax を取り、ID=0（<eos>）が出たら終了
 * - ID i は charList[i - 1] に対応（ID 1〜3 も通常の文字。特殊トークンではない）
 * - PARSeq は自己回帰モデルなので CTC のような連続重複除去は行わない
 */

export function argmaxDecode(logits: ArrayLike<number>, seqLength: number, vocabSize: number): number[] {
  const ids: number[] = []
  for (let i = 0; i < seqLength; i++) {
    const base = i * vocabSize
    let maxIdx = 0
    let maxVal = -Infinity
    for (let v = 0; v < vocabSize; v++) {
      const val = logits[base + v]
      if (val > maxVal) {
        maxVal = val
        maxIdx = v
      }
    }
    if (maxIdx === 0) break
    ids.push(maxIdx)
  }
  return ids
}

export function idsToText(ids: number[], charList: string[]): string {
  let out = ''
  for (const id of ids) {
    const ch = charList[id - 1]
    if (ch !== undefined) out += ch
  }
  return out
}

/**
 * NDLmoji.yaml の charset_train 文字列を文字配列に変換
 * サロゲートペア（例: 𢌞）を 1 文字として扱うため Array.from を使う
 */
export function parseCharset(charset: string): string[] {
  return Array.from(charset)
}

/** 本家 v2: 「、」「。」の前後にある半角スペースを除去 */
export function removeAsciiSpacesAroundJapanesePunctuation(text: string): string {
  let out = text
  for (const p of ['、', '。']) {
    out = out.split(` ${p}`).join(p).split(`${p} `).join(p)
  }
  return out
}
