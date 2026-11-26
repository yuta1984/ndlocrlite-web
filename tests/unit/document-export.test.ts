import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  joinTextblockLines, escapeMarkdownParagraph, buildFragments, toMarkdown, toHtmlDocument,
  toUpstreamJson, toUpstreamXml, toParagraphText, type ExportPage,
} from '../../src/utils/document-export'
import type { TextBlock } from '../../src/types/ocr'
import { FIXTURES } from '../helpers'

const ref: Array<{ lines: string[]; joined: string; escaped: string }> = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'upstream-v2', 'join_textblock_lines.json'), 'utf-8')
)

const line = (text: string, x: number, y: number, classId = 1, w = 200, h = 20): TextBlock => ({
  x, y, width: w, height: h, confidence: 0.9, classId, text, readingOrder: 0, charCountCategory: 2,
})

const page: ExportPage = {
  fileName: 'p.png',
  imageWidth: 1000,
  imageHeight: 1000,
  pageBlocks: [{ x: 0, y: 90, width: 500, height: 100 }],
  textBlocks: [
    line('第1章 <序>', 0, 10, 16),
    line('This is a', 0, 100),
    line('pen.', 0, 130),
    line('ブロック外', 600, 600),
    line('表の中', 100, 820),
  ],
  tables: [{ layoutBbox: [50, 800, 400, 900], html: '<table class="tablecenternet"><tr><td>表の中</td></tr></table>', markdown: '| 表の中 |\n| --- |' }],
}

describe('段落結合（本家 _join_textblock_lines 互換）', () => {
  for (const c of ref) {
    it(JSON.stringify(c.lines), () => {
      expect(joinTextblockLines(c.lines)).toBe(c.joined)
      expect(escapeMarkdownParagraph(c.joined + ' *a* #1 [x]')).toBe(c.escaped)
    })
  }
})

describe('構造化出力', () => {
  it('見出し・段落・表に分ける', () => {
    const f = buildFragments(page)
    expect(f.map((x) => x.kind)).toEqual(['heading', 'paragraph', 'paragraph', 'table'])
    expect(f[1]).toEqual({ kind: 'paragraph', text: 'This is a pen.' })
  })

  it('Markdown: 見出しは ##、本文はエスケープ、表は Markdown 表', () => {
    const md = toMarkdown(page)
    expect(md).toBe('## 第1章 \\<序\\>\n\nThis is a pen.\n\nブロック外\n\n| 表の中 |\n| --- |')
  })

  it('テキスト変換（包摂など）を適用できる', () => {
    expect(toParagraphText(page, (t) => t.replace('pen', 'PEN'))).toContain('This is a PEN.')
  })

  it('HTML: テキストはエスケープし、表 HTML は埋め込む', () => {
    const html = toHtmlDocument('t<1>', [page])
    expect(html).toContain('<title>t&lt;1&gt;</title>')
    expect(html).toContain('<h2>第1章 &lt;序&gt;</h2>')
    expect(html).toContain('<table class="tablecenternet">')
  })

  it('JSON: 本家と同じキー構成', () => {
    const obj = JSON.parse(toUpstreamJson([page]))
    expect(Object.keys(obj)).toEqual(['contents', 'imginfo'])
    expect(obj.contents[0][1]).toEqual({
      boundingBox: [[0, 100], [0, 120], [200, 100], [200, 120]],
      id: 1, isVertical: 'false', text: 'This is a', isTextline: 'true', confidence: 0.9, class_index: 1,
    })
    const upstream = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'upstream-v2', 'kumonoito.json'), 'utf-8'))
    expect(Object.keys(obj.contents[0][0]).sort()).toEqual(Object.keys(upstream.contents[0][0]).sort())
    expect(Object.keys(obj.imginfo).sort()).toEqual(Object.keys(upstream.imginfo).sort())
  })

  it('XML: タグの対応が取れており、属性値はエスケープされる', () => {
    const xml = toUpstreamXml([page])
    expect(xml).toContain('TYPE="タイトル本文"')
    expect(xml).toContain('STRING="第1章 &lt;序&gt;"')
    expect(xml).toContain('<BLOCK TYPE="表組"')
    const open = (xml.match(/<(OCRDATASET|PAGE|TEXTBLOCK|BLOCK)[\s>]/g) ?? []).length
    const close = (xml.match(/<\/(OCRDATASET|PAGE|TEXTBLOCK|BLOCK)>/g) ?? []).length
    expect(open).toBe(close)
  })
})
