import { useState } from 'react'
import type { OCRResult } from '../../types/ocr'
import { downloadFile, copyToClipboard, type ExportFormat } from '../../utils/textExport'
import { buildExport } from '../../utils/export-builder'
import { useSettings } from '../../utils/settings'
import { useTextTransform } from '../../hooks/useTextTransform'

interface ResultActionsProps {
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

/** 選択中の資料の認識結果をコピー / ダウンロード（形式・オプションは設定に保存して全体で共有） */
export function ResultActions({ currentResult, lang }: ResultActionsProps) {
  const ja = lang === 'ja'
  const [copied, setCopied] = useState(false)
  const [settings, updateSettings] = useSettings()
  const transform = useTextTransform()
  const format = settings.exportFormat
  const opts = { format, includeFileName: settings.includeFileName, ignoreNewlines: settings.ignoreNewlines }
  const isPlainText = format === 'txt' || format === 'paragraph'

  const handleCopy = async () => {
    if (!currentResult) return
    try {
      await copyToClipboard(buildExport([currentResult], currentResult.fileName, opts, transform))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert(ja ? 'コピーに失敗しました' : 'Failed to copy')
    }
  }

  const handleDownload = () => {
    if (!currentResult) return
    downloadFile(buildExport([currentResult], currentResult.fileName, opts, transform), currentResult.fileName, format)
  }

  const disabled = !currentResult

  return (
    <div className="result-actions">
      <div className="result-actions-options">
        <label className="result-actions-option result-actions-format">
          {ja ? '形式' : 'Format'}
          <select
            value={format}
            onChange={(e) => updateSettings({ exportFormat: e.target.value as ExportFormat })}
            data-testid="export-format"
          >
            {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
              <option key={f} value={f}>{FORMAT_LABELS[f][lang]}</option>
            ))}
          </select>
        </label>
        {(isPlainText || format === 'md') && (
          <label className="result-actions-option">
            <input
              type="checkbox"
              checked={settings.includeFileName}
              onChange={(e) => updateSettings({ includeFileName: e.target.checked })}
            />
            {ja ? 'ファイル名を記載' : 'Include file name'}
          </label>
        )}
        {isPlainText && (
          <label className="result-actions-option">
            <input
              type="checkbox"
              checked={settings.ignoreNewlines}
              onChange={(e) => updateSettings({ ignoreNewlines: e.target.checked })}
            />
            {ja ? '改行を無視' : 'Ignore newlines'}
          </label>
        )}
      </div>
      <div className="result-actions-buttons">
        <button className="btn btn-primary" onClick={handleCopy} disabled={disabled}>
          {copied ? (ja ? 'コピーしました！' : 'Copied!') : (ja ? 'コピー' : 'Copy')}
        </button>
        <button className="btn btn-secondary" onClick={handleDownload} disabled={disabled}>
          {ja ? 'ダウンロード' : 'Download'}
        </button>
      </div>
    </div>
  )
}
