import type { OCRJobState } from '../../types/ocr'
import type { Language } from '../../i18n'
import { createTranslator } from '../../i18n'

interface ProgressBarProps {
  jobState: OCRJobState
  lang: Language
}

export function ProgressBar({ jobState, lang }: ProgressBarProps) {
  const t = createTranslator(lang)
  const { status, currentFileIndex, totalFiles, stageProgress, stage, message, modelProgress } = jobState

  if (status === 'idle') return null

  const isError = status === 'error'
  const isDone = status === 'done'
  const isDownloading = stage === 'loading_models' && modelProgress != null

  if (isDownloading) {
    return (
      <div className="progress-container">
        <div className="progress-title">{t('progress.downloadingModels')}...</div>
        <div className="model-download-bars">
          {(
            [
              ['det', t('progress.detModel')],
              ['rec', t('progress.recModel')],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="model-download-row">
              <div className="model-download-label">{label}</div>
              <div className="model-download-bar-wrap">
                <div className="progress-bar-track">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${Math.round(modelProgress[key] * 100)}%` }}
                  />
                </div>
                <span className="model-download-pct">{Math.round(modelProgress[key] * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // 全体進捗: ファイル単位 + 現在ファイル内の進捗
  const overallProgress =
    totalFiles > 0
      ? ((currentFileIndex - 1 + stageProgress) / totalFiles) * 100
      : stageProgress * 100

  return (
    <div className={`progress-container ${isError ? 'error' : ''}`}>
      {totalFiles > 1 && (
        <div className="progress-files">
          {t('progress.filesCount', { current: currentFileIndex, total: totalFiles })}
        </div>
      )}
      <div className="progress-bar-track">
        <div
          className={`progress-bar-fill ${isDone ? 'done' : ''}`}
          style={{ width: `${Math.min(100, overallProgress)}%` }}
        />
      </div>
      <div className="progress-message">
        {isError ? jobState.errorMessage : message}
      </div>
    </div>
  )
}
