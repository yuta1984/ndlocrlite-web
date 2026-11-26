/**
 * 表の後処理（罫線格子・OCR 行割り当て・欠損セル補完・HTML/Markdown）を
 * 本家の出力（tests/fixtures/upstream-v2-table/synthetic_ruled.json）と比較する
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  ruledTableCells, assignOcrLinesToCells, cellsToHtml, cellsToMarkdown, type WorkCell, type OcrLine, type BBox,
} from '../../src/worker/table/structure'
import { buildTablesHtmlDocument, mergeOverlappingTableRegions } from '../../src/worker/table/tablecenternet'
import { FIXTURES, loadImage } from '../helpers'

const DIR = path.join(FIXTURES, 'upstream-v2-table')
const ref = JSON.parse(fs.readFileSync(path.join(DIR, 'synthetic_ruled.json'), 'utf-8'))
const image = loadImage(path.join(DIR, 'synthetic_ruled.png'))

interface RefCell { score: number; corners: number[][]; logic_axis_0based: number[]; synthetic?: boolean; ocr_texts?: string[] }

const toWork = (c: RefCell): WorkCell => ({
  score: c.score,
  corners: c.corners.map(([x, y]) => [x, y] as [number, number]),
  logic: c.logic_axis_0based as [number, number, number, number],
})
const lines = (): OcrLine[] => ref.lines.map((l: { x: number; y: number; width: number; height: number; text: string }, i: number) => ({
  id: i, x1: l.x, y1: l.y, x2: l.x + l.width, y2: l.y + l.height, text: l.text, isVertical: l.height > l.width,
}))

describe('table structure（本家 synthetic_ruled と比較）', () => {
  it('_ruled_table_cells: 罫線格子と結合セル', () => {
    const cells = ruledTableCells(image, ref.cells.map(toWork), ref.bbox as BBox)
    expect(cells).not.toBeNull()
    expect(cells!.length).toBe(ref.ruled_cells.length)
    cells!.forEach((c, i) => {
      const r: RefCell = ref.ruled_cells[i]
      expect(c.logic).toEqual(r.logic_axis_0based)
      c.corners.forEach((p, j) => {
        expect(p[0]).toBeCloseTo(r.corners[j][0], 6)
        expect(p[1]).toBeCloseTo(r.corners[j][1], 6)
      })
    })
  })

  it('罫線経路の HTML / Markdown が本家と一致', () => {
    const cells = ruledTableCells(image, ref.cells.map(toWork), ref.bbox as BBox)!
    assignOcrLinesToCells(cells, lines(), ref.bbox as BBox)
    expect(cellsToHtml(cells)).toBe(ref.html)
    expect(cellsToMarkdown(cells)).toBe(ref.markdown)
  })

  it('モデル経路: 欠けたセルの補完と HTML / Markdown が本家と一致', () => {
    const cells: WorkCell[] = ref.cells.map(toWork).filter((c: WorkCell) => !(c.logic[0] === 3 && c.logic[2] === 4))
    assignOcrLinesToCells(cells, lines(), ref.bbox as BBox)
    expect(cells.length).toBe(ref.model_cells_out.length)
    expect(cells.filter((c) => c.synthetic).length).toBe(ref.model_cells_out.filter((c: RefCell) => c.synthetic).length)
    expect(cellsToHtml(cells)).toBe(ref.model_html)
    expect(cellsToMarkdown(cells)).toBe(ref.model_markdown)
  })

  it('罫線がない画像では null（モデルのトポロジを維持）', () => {
    const blank = { data: new Uint8ClampedArray(200 * 200 * 4).fill(255), width: 200, height: 200 }
    expect(ruledTableCells(blank, ref.cells.map(toWork), [0, 0, 200, 200])).toBeNull()
  })

  it('空のセル列', () => {
    expect(cellsToHtml([])).toBe('<table class="tablecenternet"><tbody></tbody></table>')
    expect(cellsToMarkdown([])).toBe('_表セルを検出できませんでした。_')
  })

  it('_merge_overlapping_table_regions: 連結成分を外接矩形にまとめる', () => {
    const merged = mergeOverlappingTableRegions([
      { index: 0, bbox: [0, 0, 10, 10], confidence: 0.5, sourceTableIndexes: [1] },
      { index: 1, bbox: [50, 50, 60, 60], confidence: 0.9, sourceTableIndexes: [2] },
      { index: 2, bbox: [5, 5, 20, 20], confidence: 0.7, sourceTableIndexes: [3] },
      { index: 3, bbox: [10, 0, 30, 6], confidence: 0.1, sourceTableIndexes: [4] }, // [0,0,10,10] とは辺の接触のみだが [5,5,20,20] と重なる
    ])
    expect(merged.map((m) => [m.bbox, m.confidence, m.sourceTableIndexes])).toEqual([
      [[0, 0, 30, 20], 0.7, [1, 3, 4]],
      [[50, 50, 60, 60], 0.9, [2]],
    ])
  })

  it('buildTablesHtmlDocument は本家 build_tables_html_document と同じ', () => {
    const page = JSON.parse(fs.readFileSync(path.join(DIR, 'digidepo_3048008_0025.json'), 'utf-8'))
    const tables = page.tables.map((t: { table_index: number; layout_bbox: [number, number, number, number]; html: string }) => ({
      tableIndex: t.table_index, layoutBbox: t.layout_bbox, html: t.html,
    }))
    expect(buildTablesHtmlDocument(page.image, tables)).toBe(page.html_document)
  })
})
