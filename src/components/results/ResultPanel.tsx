import type { OCRResult, TextBlock } from '../../types/ocr'
import type { Language } from '../../i18n'
import { createTranslator } from '../../i18n'

interface ResultPanelProps {
  result: OCRResult | null
  selectedBlock: TextBlock | null
  selectedPageBlockText?: string | null
  lang: Language
}

export function ResultPanel({ result, selectedBlock, selectedPageBlockText, lang }: ResultPanelProps) {
  const t = createTranslator(lang)

  if (!result) {
    return (
      <div className="result-panel empty">
        <p>{t('results.noResult')}</p>
      </div>
    )
  }

  return (
    <div className="result-panel">
      <div className="result-header">
        <span className="result-filename">{result.fileName}</span>
        <span className="result-stats">
          {t('results.regions', { count: result.textBlocks.length })}
          {' · '}
          {(result.processingTimeMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="result-text">
        {result.textBlocks.length === 0 ? (
          <p className="no-text">
            {t('results.noTextDetected')}
          </p>
        ) : selectedPageBlockText != null ? (
          <div>
            <div className="selected-text-label">
              {t('results.blockText')}
            </div>
            <div className="selected-text">{selectedPageBlockText || '(空)'}</div>
            <hr className="divider" />
            <pre className="full-text">{result.fullText}</pre>
          </div>
        ) : selectedBlock ? (
          <div>
            <div className="selected-text-label">
              {t('results.selectedRegion')}
            </div>
            <div className="selected-text">{selectedBlock.text || '(空)'}</div>
            <hr className="divider" />
            <div className="full-text">{result.fullText}</div>
          </div>
        ) : (
          <pre className="full-text">{result.fullText}</pre>
        )}
      </div>
    </div>
  )
}
