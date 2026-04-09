import { useState } from 'react'
import type { DBRunEntry } from '../../types/db'
import type { Language } from '../../i18n'
import { createTranslator } from '../../i18n'

const LOCALE_MAP: Record<Language, string> = {
  ja: 'ja-JP',
  en: 'en-US',
  zh: 'zh-CN',
  ko: 'ko-KR',
}

interface HistoryPanelProps {
  runs: DBRunEntry[]
  onSelect: (entry: DBRunEntry) => void
  onClear: () => void
  onClose: () => void
  lang: Language
}

export function HistoryPanel({ runs, onSelect, onClear, onClose, lang }: HistoryPanelProps) {
  const t = createTranslator(lang)
  const [confirmClear, setConfirmClear] = useState(false)

  const handleClear = () => {
    if (confirmClear) {
      onClear()
      setConfirmClear(false)
    } else {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
    }
  }

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleString(LOCALE_MAP[lang], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h2>{t('history.title')}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="panel-body">
          {runs.length === 0 ? (
            <p className="empty-message">
              {t('history.empty')}
            </p>
          ) : (
            <ul className="history-list">
              {runs.map((run) => {
                const firstFile = run.files[0]
                const fileCount = run.files.length
                const previewText = run.files.map(f => f.fullText).join(' ').slice(0, 60)
                return (
                  <li key={run.id} className="history-item" onClick={() => onSelect(run)}>
                    {firstFile && (
                      <img
                        src={firstFile.imageDataUrl}
                        alt={firstFile.fileName}
                        className="history-thumb"
                      />
                    )}
                    <div className="history-info">
                      <span className="history-filename">
                        {fileCount === 1
                          ? firstFile?.fileName
                          : t('history.moreFiles', { name: firstFile?.fileName ?? '', count: fileCount - 1 })}
                      </span>
                      <span className="history-date">{formatDate(run.createdAt)}</span>
                      <span className="history-preview">
                        {previewText
                          ? previewText + '...'
                          : t('history.noText')}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="panel-footer">
          <button
            className={`btn ${confirmClear ? 'btn-danger' : 'btn-secondary'}`}
            onClick={handleClear}
            disabled={runs.length === 0}
          >
            {confirmClear ? t('history.confirmDelete') : t('history.clearCache')}
          </button>
        </div>
      </div>
    </div>
  )
}
