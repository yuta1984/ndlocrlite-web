import { useEffect, useRef, useState } from 'react'
import type { OcrDocument, DocStatus } from '../../state/documents'
import { ACCEPT_ATTR, filterAcceptedFiles } from '../../utils/file-accept'

export interface SampleDef {
  url: string
  fileName: string
  type: string
  title: { ja: string; en: string }
}

interface SidebarProps {
  lang: 'ja' | 'en'
  docs: OcrDocument[]
  selectedId: string | null
  samples: SampleDef[]
  /** ファイル読み込み中 or 認識中 */
  busy: boolean
  isRecognizing: boolean
  loadingMessage: string | null
  open: boolean
  onClose: () => void
  onAddFiles: (files: File[]) => void
  onPaste: () => void
  onSample: (sample: SampleDef) => void
  onSelect: (id: string) => void
  onRecognizeAll: () => void
  onRecognizeOne: (id: string) => void
  onRemove: (id: string) => void
  onDownloadAll: () => void
  onClear: () => void
}

const STATUS_LABEL: Record<DocStatus, { ja: string; en: string }> = {
  pending: { ja: '未処理', en: 'Pending' },
  processing: { ja: '認識中', en: 'Running' },
  done: { ja: '完了', en: 'Done' },
  error: { ja: 'エラー', en: 'Error' },
}

/** 画像の追加手段（初期表示ではボタンを並べ、登録後は「＋ 画像を追加」メニューに収納） */
function AddSources({
  lang, samples, disabled, compact, onAddFiles, onPaste, onSample, onDone,
}: {
  lang: 'ja' | 'en'
  samples: SampleDef[]
  disabled: boolean
  compact: boolean
  onAddFiles: (files: File[]) => void
  onPaste: () => void
  onSample: (s: SampleDef) => void
  onDone?: () => void
}) {
  const ja = lang === 'ja'
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)
  const handle = (files: FileList | null) => {
    const accepted = filterAcceptedFiles(files)
    if (accepted.length > 0) onAddFiles(accepted)
    onDone?.()
  }
  const cls = compact ? 'add-menu-item' : 'btn btn-secondary sidebar-btn'
  return (
    <>
      <button className={compact ? cls : 'btn btn-primary sidebar-btn'} onClick={() => fileRef.current?.click()} disabled={disabled}>
        {ja ? '＋ ファイルを追加' : '+ Add files'}
      </button>
      <button className={cls} onClick={() => dirRef.current?.click()} disabled={disabled}>
        📂 {ja ? 'フォルダを選択' : 'Select folder'}
      </button>
      <button className={cls} onClick={() => { onPaste(); onDone?.() }} disabled={disabled}>
        📋 {ja ? 'クリップボードから貼り付け' : 'Paste from clipboard'}
      </button>
      {samples.map((s, i) => (
        <button key={s.url} className={cls} onClick={() => { onSample(s); onDone?.() }} disabled={disabled} title={s.title[lang]}>
          {ja ? `サンプル${i + 1}` : `Sample ${i + 1}`}
          <span className="sidebar-btn-note">{s.title[lang].replace(/（.*$|\s\(.*$/, '')}</span>
        </button>
      ))}
      <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} hidden onChange={(e) => { handle(e.target.files); e.target.value = '' }} />
      <input
        ref={dirRef}
        type="file"
        // @ts-expect-error webkitdirectory is not in standard types
        webkitdirectory=""
        multiple
        hidden
        onChange={(e) => { handle(e.target.files); e.target.value = '' }}
      />
    </>
  )
}

export function Sidebar(props: SidebarProps) {
  const {
    lang, docs, selectedId, samples, busy, isRecognizing, loadingMessage, open, onClose,
    onAddFiles, onPaste, onSample, onSelect, onRecognizeAll, onRecognizeOne, onRemove, onDownloadAll, onClear,
  } = props
  const ja = lang === 'ja'
  const [menuOpen, setMenuOpen] = useState(false)
  const [itemMenu, setItemMenu] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)

  const recognizable = docs.filter((d) => d.image && (d.status === 'pending' || d.status === 'error')).length
  const doneCount = docs.filter((d) => d.status === 'done').length
  const hasDocs = docs.length > 0

  // 選択中の資料が見えるようにスクロール
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // メニューは外側クリックで閉じる
  useEffect(() => {
    if (!menuOpen && !itemMenu) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.add-menu, .doc-item-menu, .add-menu-toggle, .doc-item-more')) {
        setMenuOpen(false)
        setItemMenu(null)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen, itemMenu])

  const handleClear = () => {
    if (confirmClear) {
      onClear()
      setConfirmClear(false)
    } else {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
    }
  }

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'open' : ''}`} onClick={onClose} aria-hidden />
      <aside id="app-sidebar" className={`sidebar ${open ? 'open' : ''}`} aria-label={ja ? '画像一覧' : 'Images'}>
        {!hasDocs ? (
          <div className="sidebar-section sidebar-add">
            <div className="sidebar-heading">{ja ? '① 画像を追加する' : '① Add images'}</div>
            <AddSources
              lang={lang} samples={samples} disabled={busy} compact={false}
              onAddFiles={onAddFiles} onPaste={onPaste} onSample={onSample}
            />
            <p className="sidebar-hint">
              {ja ? 'JPG / PNG / TIFF / HEIC / PDF。ドラッグ＆ドロップや Ctrl+V でも追加できます。' : 'JPG / PNG / TIFF / HEIC / PDF. You can also drag & drop or press Ctrl+V.'}
            </p>
          </div>
        ) : (
          <div className="sidebar-section sidebar-toolbar">
            <div className="add-menu-wrap">
              <button
                className="btn btn-secondary sidebar-btn add-menu-toggle"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={busy}
              >
                {ja ? '＋ 画像を追加' : '+ Add images'} ▾
              </button>
              {menuOpen && (
                <div className="add-menu" role="menu">
                  <AddSources
                    lang={lang} samples={samples} disabled={busy} compact
                    onAddFiles={onAddFiles} onPaste={onPaste} onSample={onSample}
                    onDone={() => setMenuOpen(false)}
                  />
                </div>
              )}
            </div>
            <button
              className="btn btn-primary sidebar-btn"
              onClick={onRecognizeAll}
              disabled={busy || recognizable === 0}
              data-testid="recognize-all"
            >
              {isRecognizing
                ? (ja ? '認識中…' : 'Recognizing…')
                : ja ? `② 認識を開始（${recognizable}件）` : `② Recognize (${recognizable})`}
            </button>
          </div>
        )}

        {loadingMessage && <div className="sidebar-loading" role="status"><span className="file-loading-spinner" />{loadingMessage}</div>}

        {hasDocs && (
          <ul className="doc-list" ref={listRef} aria-label={ja ? '画像一覧' : 'Image list'}>
            {docs.map((doc, i) => (
              <li key={doc.id} className={`doc-item ${doc.id === selectedId ? 'active' : ''}`} aria-current={doc.id === selectedId}>
                <button className="doc-item-main" onClick={() => { onSelect(doc.id); onClose() }} title={doc.name}>
                  <span className="doc-item-index">{i + 1}</span>
                  <span className="doc-item-thumb">
                    <img src={doc.thumbnailDataUrl} alt="" loading="lazy" />
                    {doc.status === 'processing' && <span className="sidebar-item-spinner" />}
                  </span>
                  <span className="doc-item-body">
                    <span className="doc-item-name">{doc.name}</span>
                    <span className={`doc-status doc-status-${doc.status}`} title={doc.error}>
                      {STATUS_LABEL[doc.status][lang]}
                    </span>
                  </span>
                </button>
                <button
                  className="doc-item-more"
                  onClick={() => setItemMenu(itemMenu === doc.id ? null : doc.id)}
                  aria-label={ja ? 'メニュー' : 'Menu'}
                  aria-haspopup="menu"
                  aria-expanded={itemMenu === doc.id}
                >⋯</button>
                {itemMenu === doc.id && (
                  <div className="doc-item-menu" role="menu">
                    {doc.image && (
                      <button
                        role="menuitem"
                        disabled={busy}
                        onClick={() => { setItemMenu(null); onRecognizeOne(doc.id) }}
                      >
                        {doc.status === 'done' ? (ja ? '再認識' : 'Recognize again') : (ja ? 'この画像を認識' : 'Recognize this image')}
                      </button>
                    )}
                    <button
                      role="menuitem"
                      disabled={doc.status === 'processing'}
                      onClick={() => { setItemMenu(null); onRemove(doc.id) }}
                    >
                      {ja ? '一覧から削除' : 'Remove'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {hasDocs && (
          <div className="sidebar-section sidebar-batch">
            <div className="sidebar-heading">{ja ? '一括処理' : 'Batch'}</div>
            <button className="btn btn-secondary sidebar-btn" onClick={onDownloadAll} disabled={doneCount === 0}>
              {ja ? `すべてダウンロード（${doneCount}件）` : `Download all (${doneCount})`}
            </button>
            <button className="btn-text sidebar-clear" onClick={handleClear} disabled={isRecognizing}>
              {confirmClear ? (ja ? 'もう一度押すとすべてクリア' : 'Click again to clear all') : (ja ? 'すべてクリア' : 'Clear all')}
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
