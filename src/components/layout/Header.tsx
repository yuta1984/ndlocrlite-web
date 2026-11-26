import type { Language } from '../../i18n'

interface HeaderProps {
  lang: Language
  onToggleLanguage: () => void
  onOpenSettings: () => void
  onOpenHistory: () => void
  onOpenAbout: () => void
  onLogoClick: () => void
  /** モバイル: サイドバー（ドロワー）を開く */
  onOpenMenu: () => void
  menuOpen: boolean
}

export function Header({
  lang, onToggleLanguage, onOpenSettings, onOpenHistory, onOpenAbout, onLogoClick, onOpenMenu, menuOpen,
}: HeaderProps) {
  const ja = lang === 'ja'
  return (
    <header className="header">
      <button
        className="btn-icon header-menu"
        onClick={onOpenMenu}
        aria-label={ja ? '画像一覧を開く' : 'Open image list'}
        aria-expanded={menuOpen}
        aria-controls="app-sidebar"
      >
        ☰
      </button>
      <button className="header-title" onClick={onLogoClick}>
        <h1>NDLOCR-Lite Web</h1>
        <span className="header-subtitle">
          {ja ? 'ブラウザで動く日本語OCR' : 'Japanese OCR in the Browser'}
        </span>
      </button>
      <div className="header-actions">
        <button className="header-link" onClick={onOpenAbout} aria-label={ja ? 'このアプリについて' : 'About'}>
          <span className="header-link-full">{ja ? 'このアプリについて' : 'About'}</span>
          <span className="header-link-short" aria-hidden>ⓘ</span>
        </button>
        <button className="btn-icon" onClick={onOpenHistory} title={ja ? '処理履歴' : 'History'} aria-label={ja ? '処理履歴' : 'History'}>
          📋
        </button>
        <button className="btn-icon" onClick={onOpenSettings} title={ja ? '設定' : 'Settings'} aria-label={ja ? '設定' : 'Settings'}>
          ⚙️
        </button>
        <button className="btn-lang" onClick={onToggleLanguage}>
          {ja ? 'EN' : '日本語'}
        </button>
      </div>
    </header>
  )
}
