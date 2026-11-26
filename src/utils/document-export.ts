/**
 * OCR 結果の構造化出力（段落結合 / Markdown / HTML / 本家互換 JSON・XML）
 * 参照実装: ndlocr-lite v2 src/ocr.py（_join_textblock_lines, build_markdown_text_from_page ほか）
 *
 * - 同じ本文ブロック（text_block）に属する行を 1 段落に結合する（物理的な改行を除去）
 * - タイトル行（line_title）は見出しにする
 * - 表構造推定の結果がある場合、表領域内の行は表に置き換える
 */

import type { BoundingBox, PageBlock, TextBlock } from '../types/ocr'

export interface ExportTable {
  layoutBbox: [number, number, number, number]
  html: string
  markdown: string
  error?: string
}

export interface ExportPage {
  fileName: string
  imageWidth?: number
  imageHeight?: number
  /** 読み順に並んだ行 */
  textBlocks: TextBlock[]
  pageBlocks?: PageBlock[]
  tables?: ExportTable[]
}

export type TextTransform = (text: string) => string
const identity: TextTransform = (t) => t

export type Fragment =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'table'; html: string; markdown: string }

const LINE_TITLE_CLASS_ID = 16

/** ndl.yaml のクラスID → 本家 XML の TYPE 名 */
export const CLASS_ORG_NAMES: Record<number, string> = {
  0: '本文ブロック', 1: '本文', 2: 'キャプション', 3: '広告文字', 4: '割注', 5: '頭注',
  6: '図版', 7: '広告', 8: '柱', 9: 'ノンブル', 10: 'ルビ', 11: '組織図', 12: '数式',
  13: '化学式', 14: '欧文', 15: '表組', 16: 'タイトル本文',
}

// ---------------------------------------------------------------------------
// 段落結合（本家 _join_textblock_lines）

function isCjkChar(ch: string): boolean {
  if (!ch) return false
  const cp = ch.codePointAt(0)!
  return (
    (cp >= 0x3040 && cp <= 0x30ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xffef)
  )
}

const CLOSING_PUNCT = new Set(Array.from(',.;:!?%)]}、。，．！？：；）］｝〉》」』】％'))
const OPENING_PUNCT = new Set(Array.from('([{（［｛〈《「『【'))
const isAlnum = (ch: string) => /^[\p{L}\p{N}]$/u.test(ch)
const isSpace = (ch: string) => /^\s$/u.test(ch)

/** 物理行を 1 つの論理段落に結合する。欧文の単語間にのみ半角スペースを補う */
export function joinTextblockLines(lines: string[]): string {
  const cleaned = lines.map((l) => String(l).replace(/[\r\n]/g, '').trim()).filter((l) => l.length > 0)
  if (cleaned.length === 0) return ''
  let out = cleaned[0]
  for (const next of cleaned.slice(1)) {
    const prevChars = Array.from(out)
    const prev = prevChars[prevChars.length - 1] ?? ''
    const first = Array.from(next)[0] ?? ''
    const needSpace =
      !!prev && !!first &&
      !isSpace(prev) && !isSpace(first) &&
      !isCjkChar(prev) && !isCjkChar(first) &&
      !OPENING_PUNCT.has(prev) && !CLOSING_PUNCT.has(first) &&
      (isAlnum(prev) || prev === "'" || prev === '"') &&
      (isAlnum(first) || first === "'" || first === '"')
    out += (needSpace ? ' ' : '') + next
  }
  return out
}

// ---------------------------------------------------------------------------
// 構造化（段落・見出し・表）

const center = (b: BoundingBox) => ({ cx: b.x + b.width / 2, cy: b.y + b.height / 2 })
const inside = (cx: number, cy: number, b: BoundingBox) => cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height
const bboxOfTable = (t: ExportTable): BoundingBox => ({
  x: t.layoutBbox[0], y: t.layoutBbox[1], width: t.layoutBbox[2] - t.layoutBbox[0], height: t.layoutBbox[3] - t.layoutBbox[1],
})

export function buildFragments(page: ExportPage, transform: TextTransform = identity): Fragment[] {
  const blocks = page.pageBlocks ?? []
  const tables = (page.tables ?? []).filter((t) => !t.error && (t.html || t.markdown))
  const tableBoxes = tables.map(bboxOfTable)
  const emittedTables = new Set<number>()
  const fragments: Fragment[] = []

  let group: { key: string; kind: 'heading' | 'paragraph'; texts: string[] } | null = null
  const flush = () => {
    if (!group) return
    const text = joinTextblockLines(group.texts)
    if (text) fragments.push({ kind: group.kind, text })
    group = null
  }

  page.textBlocks.forEach((line, i) => {
    const text = transform(line.text ?? '').trim()
    if (!text) return
    const { cx, cy } = center(line)

    const tableIdx = tableBoxes.findIndex((b) => inside(cx, cy, b))
    if (tableIdx >= 0) {
      flush()
      if (!emittedTables.has(tableIdx)) {
        emittedTables.add(tableIdx)
        fragments.push({ kind: 'table', html: tables[tableIdx].html, markdown: tables[tableIdx].markdown })
      }
      return
    }

    // ブロックに属さない行は 1 行で 1 段落（本家の TEXTBLOCK 外 LINE と同じ扱い）
    const blockIdx = blocks.findIndex((b) => inside(cx, cy, b))
    const kind = line.classId === LINE_TITLE_CLASS_ID ? 'heading' : 'paragraph'
    const key = `${blockIdx >= 0 ? `b${blockIdx}` : `l${i}`}:${kind}`
    if (!group || group.key !== key) {
      flush()
      group = { key, kind, texts: [] }
    }
    group.texts.push(text)
  })
  flush()

  // 行を含まない表は末尾に追加
  tables.forEach((t, idx) => {
    if (!emittedTables.has(idx)) fragments.push({ kind: 'table', html: t.html, markdown: t.markdown })
  })
  return fragments
}

// ---------------------------------------------------------------------------
// テキスト / Markdown / HTML

/** 段落ごとに改行を除去したプレーンテキスト（段落間は空行） */
export function toParagraphText(page: ExportPage, transform: TextTransform = identity): string {
  return buildFragments(page, transform)
    .map((f) => (f.kind === 'table' ? f.markdown : f.text))
    .join('\n\n')
}

export function escapeMarkdownParagraph(text: string): string {
  let escaped = String(text).replace(/\\/g, '\\\\')
  for (const ch of ['`', '*', '_', '{', '}', '[', ']', '<', '>', '#', '+', '-', '!', '|']) {
    escaped = escaped.split(ch).join('\\' + ch)
  }
  return escaped
}

export function toMarkdown(page: ExportPage, transform: TextTransform = identity): string {
  return buildFragments(page, transform)
    .map((f) => {
      if (f.kind === 'heading') return `## ${escapeMarkdownParagraph(f.text)}`
      if (f.kind === 'paragraph') return escapeMarkdownParagraph(f.text)
      return f.markdown.trim()
    })
    .filter((s) => s.trim())
    .join('\n\n')
}

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 1 ページ分の本文 HTML（表は表構造推定で生成した HTML をそのまま埋め込む） */
export function toHtmlFragment(page: ExportPage, transform: TextTransform = identity): string {
  return buildFragments(page, transform)
    .map((f) => {
      if (f.kind === 'heading') return `<h2>${escapeHtml(f.text)}</h2>`
      if (f.kind === 'paragraph') return `<p>${escapeHtml(f.text)}</p>`
      return f.html
    })
    .join('\n')
}

export function toHtmlDocument(title: string, pages: ExportPage[], transform: TextTransform = identity): string {
  const sections = pages.map(
    (p, i) => `<section aria-label="Page ${i + 1}">\n<p class="source">${escapeHtml(p.fileName)}</p>\n${toHtmlFragment(p, transform)}\n</section>`
  )
  return [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    'body{font-family:system-ui,-apple-system,"Yu Gothic",sans-serif;margin:24px;line-height:1.7;max-width:60em;}',
    'section+section{border-top:1px solid #aaa;margin-top:24px;padding-top:24px;}',
    '.source{color:#666;font-size:0.85em;}',
    'table{border-collapse:collapse;margin:1em 0;}',
    'td,th{border:1px solid #555;padding:4px 8px;vertical-align:top;}',
    '</style>',
    '</head>',
    '<body>',
    ...sections,
    '</body>',
    '</html>',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 本家互換 JSON / XML

export function toUpstreamJsonLines(page: ExportPage, transform: TextTransform = identity) {
  return page.textBlocks.map((b, idx) => {
    const x = Math.round(b.x), y = Math.round(b.y), w = Math.round(b.width), h = Math.round(b.height)
    return {
      boundingBox: [[x, y], [x, y + h], [x + w, y], [x + w, y + h]],
      id: idx,
      isVertical: h > w ? 'true' : 'false',
      text: transform(b.text ?? ''),
      isTextline: 'true',
      confidence: Math.round(b.confidence * 1000) / 1000,
      class_index: b.classId,
    }
  })
}

/** 本家 ocr.py の JSON 出力と同じ構造（複数ページの場合は contents に各ページの配列を並べる） */
export function toUpstreamJson(pages: ExportPage[], transform: TextTransform = identity): string {
  const obj =
    pages.length === 1
      ? {
          contents: [toUpstreamJsonLines(pages[0], transform)],
          imginfo: {
            img_width: pages[0].imageWidth ?? null,
            img_height: pages[0].imageHeight ?? null,
            img_path: pages[0].fileName,
            img_name: pages[0].fileName,
          },
        }
      : {
          contents: pages.map((p) => toUpstreamJsonLines(p, transform)),
          pages: pages.map((p, i) => ({
            page_index: i,
            img_width: p.imageWidth ?? null,
            img_height: p.imageHeight ?? null,
            img_name: p.fileName,
          })),
        }
  return JSON.stringify(obj, null, 2)
}

function xmlAttr(value: string | number): string {
  return escapeHtml(String(value)).replace(/\n/g, '&#10;')
}

function lineXml(b: TextBlock, order: number, transform: TextTransform, indent: string): string {
  const type = CLASS_ORG_NAMES[b.classId] ?? '本文'
  const cnt = b.charCountCategory ?? 0
  return (
    `${indent}<LINE TYPE="${xmlAttr(type)}" X="${Math.round(b.x)}" Y="${Math.round(b.y)}" ` +
    `WIDTH="${Math.round(b.width)}" HEIGHT="${Math.round(b.height)}" CONF="${b.confidence.toFixed(3)}" ` +
    `PRED_CHAR_CNT="${cnt}" ORDER="${order}" STRING="${xmlAttr(transform(b.text ?? ''))}" />`
  )
}

/** 本家 XML（OCRDATASET / PAGE / TEXTBLOCK / LINE）と同形式。表領域は BLOCK TYPE="表組" */
export function toUpstreamXml(pages: ExportPage[], transform: TextTransform = identity): string {
  const out: string[] = ['<OCRDATASET>']
  for (const page of pages) {
    out.push(`<PAGE IMAGENAME="${xmlAttr(page.fileName)}" WIDTH="${page.imageWidth ?? 0}" HEIGHT="${page.imageHeight ?? 0}">`)
    const blocks = page.pageBlocks ?? []
    const tableBoxes = (page.tables ?? []).map(bboxOfTable)
    let current: { key: string; lines: string[]; tag: 'TEXTBLOCK' | 'BLOCK'; box?: BoundingBox } | null = null
    const flush = () => {
      if (!current) return
      if (current.key.startsWith('l')) {
        out.push(...current.lines.map((l) => l.replace(/^ {4}/, '  ')))
      } else if (current.tag === 'BLOCK') {
        const b = current.box!
        out.push(`  <BLOCK TYPE="表組" X="${Math.round(b.x)}" Y="${Math.round(b.y)}" WIDTH="${Math.round(b.width)}" HEIGHT="${Math.round(b.height)}">`, ...current.lines, '  </BLOCK>')
      } else {
        out.push('  <TEXTBLOCK>', ...current.lines, '  </TEXTBLOCK>')
      }
      current = null
    }
    page.textBlocks.forEach((b, i) => {
      const { cx, cy } = center(b)
      const t = tableBoxes.findIndex((box) => inside(cx, cy, box))
      const k = blocks.findIndex((box) => inside(cx, cy, box))
      const key = t >= 0 ? `t${t}` : k >= 0 ? `b${k}` : `l${i}`
      if (!current || current.key !== key) {
        flush()
        current = { key, lines: [], tag: t >= 0 ? 'BLOCK' : 'TEXTBLOCK', box: t >= 0 ? tableBoxes[t] : undefined }
      }
      current.lines.push(lineXml(b, i, transform, '    '))
    })
    flush()
    out.push('</PAGE>')
  }
  out.push('</OCRDATASET>')
  return out.join('\n')
}

// ---------------------------------------------------------------------------

/** OCRResult（画面上の結果）を出力用のページ表現に変換 */
export function toExportPage(result: {
  fileName: string
  textBlocks: TextBlock[]
  pageBlocks?: PageBlock[]
  imageWidth?: number
  imageHeight?: number
  tables?: ExportTable[]
}): ExportPage {
  return {
    fileName: result.fileName,
    textBlocks: result.textBlocks,
    pageBlocks: result.pageBlocks,
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    tables: result.tables,
  }
}
