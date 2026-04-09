import { useState } from 'react'
import { clearModels } from '../../utils/db'
import type { OCRLanguage } from '../../types/ocr'
import type { Language } from '../../i18n'
import { createTranslator } from '../../i18n'

const OCR_LANGUAGE_LABELS: Record<OCRLanguage, Record<Language, string>> = {
  chinese: { ja: '中国語/日本語', en: 'Chinese/Japanese', zh: '中文/日文', ko: '중국어/일본어' },
  english: { ja: '英語', en: 'English', zh: '英文', ko: '영어' },
  korean: { ja: '韓国語', en: 'Korean', zh: '韩文', ko: '한국어' },
  latin: { ja: 'ラテン文字', en: 'Latin', zh: '拉丁文', ko: '라틴 문자' },
}

interface SettingsModalProps {
  onClose: () => void
  lang: Language
  ocrLanguage: OCRLanguage
  onOcrLanguageChange: (lang: OCRLanguage) => void
}

export function SettingsModal({ onClose, lang, ocrLanguage, onOcrLanguageChange }: SettingsModalProps) {
  const t = createTranslator(lang)
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)

  const handleClearModels = async () => {
    if (!window.confirm(t('settings.confirmClearModel'))) return

    setClearing(true)
    try {
      await clearModels()
      setCleared(true)
      setTimeout(() => setCleared(false), 2000)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel panel-small" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h2>{t('settings.title')}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="panel-body">
          <section className="settings-section">
            <h3>{t('settings.ocrLanguage')}</h3>
            <p className="settings-description">
              {t('settings.ocrLanguageDescription')}
            </p>
            <select
              className="settings-select"
              value={ocrLanguage}
              onChange={(e) => onOcrLanguageChange(e.target.value as OCRLanguage)}
            >
              {(Object.keys(OCR_LANGUAGE_LABELS) as OCRLanguage[]).map((key) => (
                <option key={key} value={key}>
                  {OCR_LANGUAGE_LABELS[key][lang]}
                </option>
              ))}
            </select>
          </section>

          <section className="settings-section">
            <h3>{t('settings.modelCache')}</h3>
            <p className="settings-description">
              {t('settings.modelCacheDescription')}
            </p>
            <button
              className="btn btn-secondary"
              onClick={handleClearModels}
              disabled={clearing}
            >
              {cleared
                ? `✓ ${t('settings.clearDone')}`
                : clearing
                  ? t('settings.clearing')
                  : t('settings.clearModelCache')}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
