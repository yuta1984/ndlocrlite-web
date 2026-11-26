import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import type { RGBAImage } from '../src/worker/image-ops'

export const ROOT = path.resolve(__dirname, '..')
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures')

export function loadImage(file: string): RGBAImage {
  const buf = fs.readFileSync(file)
  if (/\.png$/i.test(file)) {
    const png = PNG.sync.read(buf)
    return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height }
  }
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }
}

/** レーベンシュタイン距離（コードポイント単位） */
export function levenshtein(a: string, b: string): number {
  const s = Array.from(a)
  const t = Array.from(b)
  if (s.length === 0) return t.length
  if (t.length === 0) return s.length
  let prev = new Array<number>(t.length + 1)
  let cur = new Array<number>(t.length + 1)
  for (let j = 0; j <= t.length; j++) prev[j] = j
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[t.length]
}

/** 文字誤り率（改行・空白を除いて比較） */
export function cer(hyp: string, ref: string): number {
  const norm = (s: string) => s.replace(/\s+/g, '')
  const r = norm(ref)
  return r.length === 0 ? 0 : levenshtein(norm(hyp), r) / Array.from(r).length
}

/** 読み順に依存しない文字 F 値（多重集合） */
export function bagOfCharsF1(hyp: string, ref: string): number {
  const count = (s: string) => {
    const m = new Map<string, number>()
    for (const ch of Array.from(s.replace(/\s+/g, ''))) m.set(ch, (m.get(ch) ?? 0) + 1)
    return m
  }
  const h = count(hyp)
  const r = count(ref)
  let tp = 0
  let nh = 0
  let nr = 0
  for (const v of h.values()) nh += v
  for (const v of r.values()) nr += v
  for (const [k, v] of h) tp += Math.min(v, r.get(k) ?? 0)
  if (nh === 0 || nr === 0) return 0
  const p = tp / nh
  const rc = tp / nr
  return p + rc === 0 ? 0 : (2 * p * rc) / (p + rc)
}
