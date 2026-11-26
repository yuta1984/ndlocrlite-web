import { useMemo, useState } from 'react'
import type { OCRResult, TextBlock } from '../../types/ocr'
import { toExportPage, toHtmlFragment } from '../../utils/document-export'
import { useTextTransform } from '../../hooks/useTextTransform'

interface ResultPanelProps {
  result: OCRResult | null
  selectedBlock: TextBlock | null
  selectedPageBlockText?: string | null
  lang: 'ja' | 'en'
}

type ViewMode = 'lines' | 'formatted'

export function ResultPanel({ result, selectedBlock, selectedPageBlockText, lang }: ResultPanelProps) {
  const ja = lang === 'ja'
  const [viewMode, setViewMode] = useState<ViewMode>('lines')
  const transform = useTextTransform()

  // 整形表示: 本文ブロック単位で段落結合・見出し・表（表構造推定が有効な場合）を表示
  const formattedHtml = useMemo(
    () => (result && viewMode === 'formatted' ? toHtmlFragment(toExportPage(result), transform) : ''),
    [result, viewMode, transform]
  )

  if (!result) {
    return (
      <div className="result-panel empty">
        <p>{ja ? '結果なし' : 'No results'}</p>
      </div>
    )
  }

  const fullText = transform(result.fullText)
  const tableCount = result.tables?.filter((t) => !t.error).length ?? 0

  return (
    <div className="result-panel">
      <div className="result-header">
        <span className="result-filename">{result.fileName}</span>
        <span className="result-stats">
          {result.textBlocks.length}
          {ja ? ' 領域' : ' regions'}
          {tableCount > 0 && ` · ${tableCount}${ja ? ' 表' : ' tables'}`}
          {' · '}
          {(result.processingTimeMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="result-view-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={viewMode === 'lines'}
          className={`result-view-tab ${viewMode === 'lines' ? 'active' : ''}`}
          onClick={() => setViewMode('lines')}
        >
          {ja ? '行ごと' : 'Lines'}
        </button>
        <button
          role="tab"
          aria-selected={viewMode === 'formatted'}
          className={`result-view-tab ${viewMode === 'formatted' ? 'active' : ''}`}
          onClick={() => setViewMode('formatted')}
          title={ja ? '段落ごとに行を結合し、見出し・表を整形して表示します' : 'Join lines into paragraphs and show headings/tables'}
        >
          {ja ? '整形表示' : 'Formatted'}
        </button>
      </div>

      <div className="result-text">
        {result.textBlocks.length === 0 ? (
          <p className="no-text">
            {ja ? 'テキストが検出されませんでした' : 'No text detected'}
          </p>
        ) : viewMode === 'formatted' ? (
          // テキストは toHtmlFragment 内でエスケープ済み。表 HTML も生成時にセル文字列をエスケープしている
          <div className="formatted-text" dangerouslySetInnerHTML={{ __html: formattedHtml }} />
        ) : selectedPageBlockText != null ? (
          <div>
            <div className="selected-text-label">
              {ja ? 'ブロック内のテキスト:' : 'Block text:'}
            </div>
            <div className="selected-text">{transform(selectedPageBlockText) || '(空)'}</div>
            <hr className="divider" />
            <pre className="full-text">{fullText}</pre>
          </div>
        ) : selectedBlock ? (
          <div>
            <div className="selected-text-label">
              {ja ? '選択領域のテキスト:' : 'Selected region:'}
            </div>
            <div className="selected-text">{transform(selectedBlock.text) || '(空)'}</div>
            <hr className="divider" />
            <div className="full-text">{fullText}</div>
          </div>
        ) : (
          <pre className="full-text">{fullText}</pre>
        )}
      </div>
    </div>
  )
}
