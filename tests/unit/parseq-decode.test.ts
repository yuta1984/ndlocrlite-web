import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { argmaxDecode, idsToText, parseCharset } from '../../src/worker/parseq-decode'
import { charListFromYaml } from '../../src/worker/text-recognizer'
import { ROOT } from '../helpers'

/** 位置ごとに指定 ID が最大となるロジットを作る */
function logitsFor(ids: number[], vocab: number, seqLen: number): Float32Array {
  const out = new Float32Array(seqLen * vocab)
  for (let i = 0; i < seqLen; i++) {
    const id = i < ids.length ? ids[i] : 0
    out[i * vocab + id] = 10
  }
  return out
}

describe('PARSeq decode', () => {
  const charList = parseCharset(' !"#abc')

  it('ID 1〜3 は特殊トークンではなく文字表の先頭3文字', () => {
    const ids = argmaxDecode(logitsFor([5, 1, 6, 2, 3], 10, 8), 8, 10)
    expect(idsToText(ids, charList)).toBe('a b!"')
  })

  it('連続する同一文字を除去しない（自己回帰モデルのため）', () => {
    const ids = argmaxDecode(logitsFor([5, 5, 6, 6, 6], 10, 8), 8, 10)
    expect(idsToText(ids, charList)).toBe('aabbb')
  })

  it('<eos>(ID=0) で打ち切る', () => {
    const ids = argmaxDecode(logitsFor([5, 0, 6], 10, 5), 5, 10)
    expect(idsToText(ids, charList)).toBe('a')
  })

  it('NDLmoji.yaml の文字数がモデルの語彙数(7142 = 7141 + eos)と一致し、サロゲートペアを1文字として扱う', () => {
    const yamlText = fs.readFileSync(path.join(ROOT, 'public/config/NDLmoji.yaml'), 'utf-8')
    const list = charListFromYaml(yamlText)
    expect(list.length).toBe(7141)
    expect(list.slice(0, 3)).toEqual([' ', '!', '"'])
    expect(list).toContain('𢌞')
    expect(list.every((c) => Array.from(c).length === 1)).toBe(true)
  })
})
