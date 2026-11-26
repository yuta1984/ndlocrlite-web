/**
 * 表構造認識の統合テスト: Web 版と同じレイアウト検出 + 文字認識 + TableCenterNet を Node で実行し、
 * 本家 v2.0.0 の出力（tests/fixtures/upstream-v2-table/*.json, generate.py で生成）と比較する
 *
 * 文字認識の結果は本家とわずかに異なり得るため、構造（表数・グリッド形状）を主に、文字列は許容幅つきで比較する
 */
import '../../src/worker/ort-wasm'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { LayoutDetector } from '../../src/worker/layout-detector'
import { TextRecognizer, charListFromYaml } from '../../src/worker/text-recognizer'
import { REC_MODELS, type RecModelKey } from '../../src/worker/recognizer-config'
import { recognizeCascade, serialize } from '../../src/worker/cascade'
import { cropRGBA, type RGBAImage } from '../../src/worker/image-ops'
import { MODEL_FILES } from '../../src/worker/model-files'
import {
  TableStructureRecognizer, inferTablesFromPage, buildTablesHtmlDocument,
  type TableLineInput, type TableRegionInput,
} from '../../src/worker/table/tablecenternet'
import { FIXTURES, ROOT, loadImage } from '../helpers'

const MODELS_DIR = process.env.MODELS_DIR ?? path.join(ROOT, 'public', 'models', 'v2')
const modelPath = (k: keyof typeof MODEL_FILES) => path.join(MODELS_DIR, MODEL_FILES[k])
const available = (Object.keys(MODEL_FILES) as (keyof typeof MODEL_FILES)[]).every((k) => fs.existsSync(modelPath(k)))
const REF_DIR = path.join(FIXTURES, 'upstream-v2-table')

interface PageOCR { regions: TableRegionInput[]; lines: TableLineInput[] }

describe.skipIf(!available)('表構造認識（本家 v2.0.0 との比較）', () => {
  let layout: LayoutDetector
  const recs = new Map<RecModelKey, TextRecognizer>()
  const table = new TableStructureRecognizer()

  beforeAll(async () => {
    const charList = charListFromYaml(fs.readFileSync(path.join(ROOT, 'public/config/NDLmoji.yaml'), 'utf-8'))
    layout = new LayoutDetector()
    await layout.initialize(fs.readFileSync(modelPath('layout')))
    for (const key of Object.keys(REC_MODELS) as RecModelKey[]) {
      const r = new TextRecognizer(REC_MODELS[key].inputShape)
      await r.initialize(fs.readFileSync(modelPath(key)), charList)
      recs.set(key, r)
    }
    await table.initialize(fs.readFileSync(modelPath('table')))
  })

  afterAll(() => {
    layout?.dispose()
    for (const r of recs.values()) r.dispose()
    table.dispose()
  })

  async function ocrPage(image: RGBAImage): Promise<PageOCR> {
    const { lines, tables } = await layout.detect(image)
    const recognize = serialize(async (model: RecModelKey, img: RGBAImage) => (await recs.get(model)!.recognizeCropped(img)).text)
    const texts = await recognizeCascade(
      lines.map((r) => ({ image: cropRGBA(image, r.x, r.y, r.width, r.height), charCountCategory: r.charCountCategory })),
      recognize
    )
    return {
      regions: tables,
      lines: lines.map((r, i) => ({ x: r.x, y: r.y, width: r.width, height: r.height, text: texts[i] })),
    }
  }

  it('digidepo_3048008_0025: 表数・グリッド形状・セル文字列が本家と一致', async () => {
    const ref = JSON.parse(fs.readFileSync(path.join(REF_DIR, 'digidepo_3048008_0025.json'), 'utf-8'))
    const image = loadImage(path.join(FIXTURES, 'images', 'digidepo_3048008_0025.jpg'))
    const page = await ocrPage(image)
    const t0 = performance.now()
    const tables = await inferTablesFromPage(image, page.regions, page.lines, table)
    const ms = performance.now() - t0

    expect(tables.length).toBe(ref.tables.length)
    for (let k = 0; k < tables.length; k++) {
      const ts = tables[k]
      const up = ref.tables[k]
      expect(ts.error).toBeUndefined()
      // レイアウト矩形の差は数 px 以内
      ts.layoutBbox.forEach((v, i) => expect(Math.abs(v - up.layout_bbox[i])).toBeLessThanOrEqual(4))
      expect([ts.rows, ts.cols]).toEqual(up.grid_shape)
      expect(ts.structureSource).toBe(up.structure_source)

      // 論理位置ごとのテキスト比較（本家で非空のセル）
      const upText = new Map<string, string>()
      for (const c of up.cells) {
        const texts = (c.ocr_texts as string[]).filter(Boolean)
        if (texts.length) upText.set(c.logic_axis_0based.join(','), [...texts].sort().join('|'))
      }
      const tsText = new Map<string, string>()
      for (const c of ts.cells) if (c.text) tsText.set(c.logic.join(','), c.text.split('<br>').sort().join('|'))
      let same = 0
      const diffs: string[] = []
      for (const [key, v] of upText) {
        if (tsText.get(key) === v) same++
        else diffs.push(`${key}: ts=${tsText.get(key) ?? '(none)'} up=${v}`)
      }
      const agreement = same / upText.size
      console.log(
        `[table ${k + 1}] grid ts=${ts.rows}x${ts.cols} up=${up.grid_shape.join('x')} cells ts=${ts.cells.length} up=${up.cells.length}` +
        ` detected ts=${ts.detectedCellCount} up=${up.detected_cell_count} recovered ts=${ts.recoveredCellCount} up=${up.recovered_cell_count}` +
        ` layout ts=${ts.layoutBbox.join(',')} up=${up.layout_bbox.join(',')} text agreement=${same}/${upText.size} (${(agreement * 100).toFixed(1)}%) html identical=${ts.html === up.html} time=${ms.toFixed(0)}ms`
      )
      if (diffs.length) console.log(diffs.join('\n'))
      // レイアウト矩形が 1px 違うだけでクロップが変わり検出セル数も多少揺れるため、セル数は ±5% で比較
      expect(Math.abs(ts.cells.length - up.cells.length)).toBeLessThanOrEqual(Math.ceil(up.cells.length * 0.05))
      expect(agreement).toBeGreaterThanOrEqual(0.9)
    }
    // 本家と同じ表領域を与えた場合（レイアウト差を除いた比較）: 構造は完全一致するはず
    const upRegions = ref.regions.map((r: { bbox: number[]; confidence: number }) => ({
      x: r.bbox[0], y: r.bbox[1], width: r.bbox[2] - r.bbox[0], height: r.bbox[3] - r.bbox[1], confidence: r.confidence,
    }))
    const same = await inferTablesFromPage(image, upRegions, page.lines, table)
    for (let k = 0; k < same.length; k++) {
      const up = ref.tables[k]
      const logic = (cells: { logic: number[] }[]) => cells.map((c) => c.logic.join(',')).sort()
      console.log(`[table ${k + 1} / upstream regions] cells ts=${same[k].cells.length} up=${up.cells.length} detected ts=${same[k].detectedCellCount} up=${up.detected_cell_count} html identical=${same[k].html === up.html}`)
      expect(same[k].detectedCellCount).toBe(up.detected_cell_count)
      expect(logic(same[k].cells)).toEqual(logic(up.cells.map((c: { logic_axis_0based: number[] }) => ({ logic: c.logic_axis_0based }))))
    }
    const doc = buildTablesHtmlDocument('digidepo_3048008_0025.jpg', tables)
    expect(doc).toContain('<table class="tablecenternet">')
  })

  it('表のない画像では []', async () => {
    const ref = JSON.parse(fs.readFileSync(path.join(REF_DIR, 'kumonoito.json'), 'utf-8'))
    const image = loadImage(path.join(FIXTURES, 'images', 'kumonoito.png'))
    const page = await ocrPage(image)
    expect(page.regions.length).toBe(0)
    expect(await inferTablesFromPage(image, page.regions, page.lines, table)).toEqual([])
    expect(ref.tables).toEqual([])
  })
})
