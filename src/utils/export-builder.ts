/**
 * 認識結果のエクスポート（テキストエリアの「コピー/ダウンロード」とサイドバーの「すべてダウンロード」で共通）
 */

import type { OCRResult } from '../types/ocr'
import type { ExportFormat } from './textExport'
import {
  toExportPage, toMarkdown, toHtmlDocument, toUpstreamJson, toUpstreamXml, toParagraphText,
  type TextTransform,
} from './document-export'

export interface ExportOptions {
  format: ExportFormat
  /** テキスト / Markdown の先頭にファイル名を記載 */
  includeFileName: boolean
  /** テキストの改行を除去 */
  ignoreNewlines: boolean
}

function buildPageText(result: OCRResult, format: ExportFormat, opts: ExportOptions, transform: TextTransform): string {
  const page = toExportPage(result)
  let body: string
  if (format === 'paragraph') body = toParagraphText(page, transform)
  else if (format === 'md') body = toMarkdown(page, transform)
  else body = transform(result.fullText)
  if (format === 'txt' || format === 'paragraph') {
    if (opts.ignoreNewlines) body = body.replace(/\n/g, '')
    if (opts.includeFileName) body = `=== ${result.fileName} ===\n${body}`
  } else if (format === 'md' && opts.includeFileName) {
    body = `# ${result.fileName}\n\n${body}`
  }
  return body
}

export function buildExport(results: OCRResult[], title: string, opts: ExportOptions, transform: TextTransform): string {
  const pages = results.map(toExportPage)
  switch (opts.format) {
    case 'html':
      return toHtmlDocument(title, pages, transform)
    case 'json':
      return toUpstreamJson(pages, transform)
    case 'xml':
      return toUpstreamXml(pages, transform)
    case 'md':
      return results.map((r) => buildPageText(r, 'md', opts, transform)).join('\n\n---\n\n')
    default:
      return results.map((r) => buildPageText(r, opts.format, opts, transform)).join('\n\n')
  }
}
