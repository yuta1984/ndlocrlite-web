/**
 * 統合テスト: 本家 ndlocr-lite v2.0.0（Python）の出力と Web 版パイプラインの出力を比較する
 * 期待値: tests/fixtures/upstream-v2/*.txt（本家 ocr.py で生成）
 * 結果は tests/reports/pipeline-<MODEL_SET>.json に保存する
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createPipeline, modelsAvailable, MODEL_SET, type Pipeline } from '../pipeline-runner'
import { FIXTURES, ROOT, loadImage, cer, bagOfCharsF1 } from '../helpers'

const IMAGES = [
  'kumonoito.png',
  'digidepo_2531162_0024.jpg',
  'digidepo_3048008_0025.jpg',
  'digidepo_11048278_po_geppo1803_00021.jpg',
  'tategaki2026-04-24-094138.png',
  'yokogaki2026-04-24-103617.png',
]

// v2 モデルでの許容値（本家との差: 主に読み順・行分割の実装差）
const THRESHOLDS: Record<string, { minF1: number; avgF1: number }> = {
  v2: { minF1: 0.98, avgF1: 0.99 },
  '202604': { minF1: 0.9, avgF1: 0.95 },
}
const threshold = THRESHOLDS[MODEL_SET] ?? THRESHOLDS['202604']

describe.skipIf(!modelsAvailable())(`pipeline vs upstream v2 (models: ${MODEL_SET})`, () => {
  let pipeline: Pipeline
  const report: Record<string, unknown> = {}

  beforeAll(async () => {
    pipeline = await createPipeline()
  })

  afterAll(() => {
    pipeline?.dispose()
    const dir = path.join(ROOT, 'tests', 'reports')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `pipeline-${MODEL_SET}.json`), JSON.stringify(report, null, 2))
  })

  for (const name of IMAGES) {
    it(name, async () => {
      const image = loadImage(path.join(FIXTURES, 'images', name))
      const ref = fs.readFileSync(path.join(FIXTURES, 'upstream-v2', name.replace(/\.[^.]+$/, '.txt')), 'utf-8')
      const t0 = performance.now()
      const result = await pipeline.run(image)
      const ms = performance.now() - t0
      const metrics = {
        cer: +cer(result.fullText, ref).toFixed(4),
        bagF1: +bagOfCharsF1(result.fullText, ref).toFixed(4),
        lines: result.lineCount,
        recCalls: result.recCalls,
        ms: Math.round(ms),
        text: result.fullText,
      }
      report[name] = metrics
      console.log(`${name}: CER=${metrics.cer} F1=${metrics.bagF1} lines=${metrics.lines} calls=${JSON.stringify(metrics.recCalls)} ${metrics.ms}ms`)
      expect(metrics.bagF1).toBeGreaterThanOrEqual(threshold.minF1)
    })
  }

  it('平均（読み順に依存しない文字F値）', () => {
    const f1s = Object.values(report).map((m) => (m as { bagF1: number }).bagF1)
    const avg = f1s.reduce((a, b) => a + b, 0) / f1s.length
    console.log(`average F1=${avg.toFixed(4)}`)
    expect(avg).toBeGreaterThanOrEqual(threshold.avgF1)
  })
})
