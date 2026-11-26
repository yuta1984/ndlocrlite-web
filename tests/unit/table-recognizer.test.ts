/**
 * TableCenterNet の前処理・推論・デコードを本家の出力と比較する（OCR 文字列に依存しない）
 *   - 本家が保存した表クロップ PNG（同一画素）で recognize() → 本家 recognize_rgb のセルと比較
 *   - 本家の OCR 行を与えた inferTablesFromPage() → 本家の HTML / Markdown と完全一致
 */
import '../../src/worker/ort-wasm'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TableStructureRecognizer, inferTablesFromPage, type TableCell } from '../../src/worker/table/tablecenternet'
import type { RGBAImage } from '../../src/worker/image-ops'
import { FIXTURES, ROOT, loadImage } from '../helpers'

const DIR = path.join(FIXTURES, 'upstream-v2-table')
const MODEL = path.join(process.env.MODELS_DIR ?? path.join(ROOT, 'public', 'models', 'v2'), 'tablecenternet_s_800_v3.onnx')

interface RefCell { score: number; corners: number[][]; logic_axis_0based: number[]; ocr_texts?: string[] }

describe.skipIf(!fs.existsSync(MODEL))('TableStructureRecognizer（本家 recognize_rgb と比較）', () => {
  const ref = JSON.parse(fs.readFileSync(path.join(DIR, 'digidepo_3048008_0025.json'), 'utf-8'))
  const t = ref.tables[0]
  const crop = loadImage(path.join(DIR, t.crop_png))
  const rec = new TableStructureRecognizer()

  beforeAll(async () => {
    await rec.initialize(fs.readFileSync(MODEL))
  })
  afterAll(() => rec.dispose())

  it('クロップ座標のセル: 個数・論理座標・角の誤差', async () => {
    const t0 = performance.now()
    const cells = await rec.recognize(crop)
    const ms = performance.now() - t0
    const upstream: RefCell[] = t.raw_local_cells
    let err = 0, n = 0, maxErr = 0, logicEq = 0
    const m = Math.min(cells.length, upstream.length)
    for (let i = 0; i < m; i++) {
      if (cells[i].logic.join() === upstream[i].logic_axis_0based.join()) logicEq++
      for (let j = 0; j < 4; j++) {
        const e = Math.hypot(cells[i].corners[j][0] - upstream[i].corners[j][0], cells[i].corners[j][1] - upstream[i].corners[j][1])
        err += e; n++; maxErr = Math.max(maxErr, e)
      }
    }
    console.log(`[table] cells ts=${cells.length} upstream=${upstream.length} logicEq=${logicEq}/${m} meanCornerErr=${(err / n).toFixed(5)}px max=${maxErr.toFixed(5)}px time=${ms.toFixed(0)}ms`)
    expect(cells.length).toBe(upstream.length)
    expect(logicEq).toBe(upstream.length)
    expect(err / n).toBeLessThan(0.05)
    expect(maxErr).toBeLessThan(0.5)
    cells.forEach((c, i) => expect(c.score).toBeCloseTo(upstream[i].score, 3))
  })

  it('本家の OCR 行を与えると HTML / Markdown が本家と完全一致', async () => {
    // クロップをページ大のキャンバスの元の位置に戻す（表外の画素は使われない）
    const [cx1, cy1] = t.crop_bbox
    const page: RGBAImage = { data: new Uint8ClampedArray(ref.width * ref.height * 4), width: ref.width, height: ref.height }
    for (let y = 0; y < crop.height; y++) {
      page.data.set(crop.data.subarray(y * crop.width * 4, (y + 1) * crop.width * 4), ((cy1 + y) * ref.width + cx1) * 4)
    }
    const regions = ref.regions.map((r: { bbox: number[]; confidence: number }) => ({
      x: r.bbox[0], y: r.bbox[1], width: r.bbox[2] - r.bbox[0], height: r.bbox[3] - r.bbox[1], confidence: r.confidence,
    }))
    const tables = await inferTablesFromPage(page, regions, ref.lines, rec)
    expect(tables.length).toBe(ref.tables.length)
    const out = tables[0]
    expect(out.tableIndex).toBe(1)
    expect(out.layoutBbox).toEqual(t.layout_bbox)
    expect(out.cropBbox).toEqual(t.crop_bbox)
    expect(out.structureSource).toBe(t.structure_source)
    expect(out.detectedCellCount).toBe(t.detected_cell_count)
    expect(out.recoveredCellCount).toBe(t.recovered_cell_count)
    expect([out.rows, out.cols]).toEqual(t.grid_shape)
    expect(out.cells.length).toBe(t.cells.length)
    out.cells.forEach((c: TableCell, i: number) => {
      expect(c.logic).toEqual(t.cells[i].logic_axis_0based)
      // text は (y, x) 順、ocr_texts はグリッド順なので集合として比較
      expect((c.text ? c.text.split('<br>') : []).sort()).toEqual((t.cells[i].ocr_texts as string[]).filter(Boolean).sort())
    })
    expect(out.html).toBe(t.html)
    expect(out.markdown).toBe(t.markdown)
  })

  it('表領域がなければ []', async () => {
    expect(await inferTablesFromPage(crop, [], [], rec)).toEqual([])
    expect(await inferTablesFromPage(crop, [{ x: 0, y: 0, width: 0, height: 10, confidence: 1 }], [], rec)).toEqual([])
  })
})
