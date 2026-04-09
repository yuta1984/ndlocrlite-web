import type { Language } from '../../i18n'

const LANG_LABELS: Record<Language, string> = {
  ja: '日本語',
  en: 'English',
  zh: '中文',
  ko: '한국어',
}

const SUBTITLE: Record<Language, string> = {
  ja: 'ブラウザで動くOCRツール',
  en: 'OCR Tool in the Browser',
  zh: '浏览器OCR工具',
  ko: '브라우저 OCR 도구',
}

const HISTORY_LABEL: Record<Language, string> = {
  ja: '処理履歴',
  en: 'History',
  zh: '历史记录',
  ko: '처리 기록',
}

const SETTINGS_LABEL: Record<Language, string> = {
  ja: '設定',
  en: 'Settings',
  zh: '设置',
  ko: '설정',
}

interface HeaderProps {
  lang: Language
  onSetLanguage: (lang: Language) => void
  onOpenSettings: () => void
  onOpenHistory: () => void
  onLogoClick: () => void
}

export function Header({ lang, onSetLanguage, onOpenSettings, onOpenHistory, onLogoClick }: HeaderProps) {
  return (
    <header className="header">
      <button className="header-title" onClick={onLogoClick}>
        <h1>Web OCR</h1>
        <span className="header-subtitle">
          {SUBTITLE[lang]}
        </span>
      </button>
      <div className="header-actions">
        <button className="btn-icon" onClick={onOpenHistory} title={HISTORY_LABEL[lang]}>
          📋
        </button>
        <button className="btn-icon" onClick={onOpenSettings} title={SETTINGS_LABEL[lang]}>
          ⚙️
        </button>
        <select
          className="btn-lang"
          value={lang}
          onChange={(e) => onSetLanguage(e.target.value as Language)}
        >
          {(Object.keys(LANG_LABELS) as Language[]).map((l) => (
            <option key={l} value={l}>{LANG_LABELS[l]}</option>
          ))}
        </select>
      </div>
    </header>
  )
}
