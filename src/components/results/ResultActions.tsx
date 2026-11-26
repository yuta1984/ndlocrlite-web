import { useState } from 'react'
import type { OCRResult } from '../../types/ocr'
import { downloadFile, copyToClipboard, type ExportFormat } from '../../utils/textExport'
import {
  toExportPage, toMarkdown, toHtmlDocument, toUpstreamJson, toUpstreamXml, toParagraphText,
} from '../../utils/document-export'
import { useTextTransform } from '../../hooks/useTextTransform'

interface ResultActionsProps {
  results: OCRResult[]
  currentResult: OCRResult | null
  lang: 'ja' | 'en'
}

const FORMAT_LABELS: Record<ExportFormat, { ja: string; en: string }> = {
  txt: { ja: 'テキスト（行ごと）', en: 'Text (lines)' },
  paragraph: { ja: 'テキスト（段落ごと）', en: 'Text (paragraphs)' },
  md: { ja: 'Markdown', en: 'Markdown' },
  html: { ja: 'HTML', en: 'HTML' },
  json: { ja: 'JSON（NDLOCR-Lite 互換）', en: 'JSON (NDLOCR-Lite)' },
  xml: { ja: 'XML（NDLOCR-Lite 互換）', en: 'XML (NDLOCR-Lite)' },
}

export function ResultActions({ results, currentResult, lang }: ResultActionsProps) {
  const ja = lang === 'ja'
  const [copied, setCopied] = useState(false)
  const [includeFileName, setIncludeFileName] = useState(false)
  const [ignoreNewlines, setIgnoreNewlines] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('txt')
  const transform = useTextTransform()

  const isPlainText = format === 'txt' || format === 'paragraph'

  /** 1 ページ分のテキスト系出力（txt / 段落 / md） */
  const buildPageText = (result: OCRResult, fmt: ExportFormat): string => {
    const page = toExportPage(result)
    let body: string
    if (fmt === 'paragraph') body = toParagraphText(page, transform)
    else if (fmt === 'md') body = toMarkdown(page, transform)
    else body = transform(result.fullText)
    if (fmt === 'txt' || fmt === 'paragraph') {
      if (ignoreNewlines) body = body.replace(/\n/g, '')
      if (includeFileName) body = `=== ${result.fileName} ===\n${body}`
    } else if (fmt === 'md' && includeFileName) {
      body = `# ${result.fileName}\n\n${body}`
    }
    return body
  }

  const buildContent = (targets: OCRResult[], title: string): string => {
    const pages = targets.map(toExportPage)
    switch (format) {
      case 'html':
        return toHtmlDocument(title, pages, transform)
      case 'json':
        return toUpstreamJson(pages, transform)
      case 'xml':
        return toUpstreamXml(pages, transform)
      case 'md':
        return targets.map((r) => buildPageText(r, 'md')).join('\n\n---\n\n')
      default:
        return targets.map((r) => buildPageText(r, format)).join('\n\n')
    }
  }

  const handleCopy = async () => {
    if (!currentResult) return
    try {
      await copyToClipboard(buildContent([currentResult], currentResult.fileName))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert(ja ? 'コピーに失敗しました' : 'Failed to copy')
    }
  }

  const handleDownload = () => {
    if (!currentResult) return
    downloadFile(buildContent([currentResult], currentResult.fileName), currentResult.fileName, format)
  }

  const handleDownloadAll = () => {
    if (results.length === 0) return
    downloadFile(buildContent(results, 'ocr_results'), 'ocr_results', format)
  }

  const disabled = !currentResult

  return (
    <div className="result-actions">
      <label className="result-actions-option result-actions-format">
        {ja ? '形式' : 'Format'}
        <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} data-testid="export-format">
          {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
            <option key={f} value={f}>{FORMAT_LABELS[f][lang]}</option>
          ))}
        </select>
      </label>
      {(isPlainText || format === 'md') && (
        <label className="result-actions-option">
          <input
            type="checkbox"
            checked={includeFileName}
            onChange={(e) => setIncludeFileName(e.target.checked)}
          />
          {ja ? 'ファイル名を記載する' : 'Include file name'}
        </label>
      )}
      {isPlainText && (
        <label className="result-actions-option">
          <input
            type="checkbox"
            checked={ignoreNewlines}
            onChange={(e) => setIgnoreNewlines(e.target.checked)}
          />
          {ja ? '改行を無視する' : 'Ignore newlines'}
        </label>
      )}
      <div className="result-actions-buttons">
        <button className="btn btn-primary" onClick={handleCopy} disabled={disabled}>
          {copied ? (ja ? 'コピーしました！' : 'Copied!') : (ja ? 'コピー' : 'Copy')}
        </button>
        <button className="btn btn-secondary" onClick={handleDownload} disabled={disabled}>
          {ja ? 'ダウンロード' : 'Download'}
        </button>
        {results.length > 1 && (
          <button className="btn btn-secondary" onClick={handleDownloadAll}>
            {ja ? '全てダウンロード' : 'Download All'}
          </button>
        )}
      </div>
    </div>
  )
}
