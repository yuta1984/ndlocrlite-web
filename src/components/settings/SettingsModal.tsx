import { useState } from 'react'
import { clearModels } from '../../utils/db'
import { useSettings } from '../../utils/settings'

interface SettingsModalProps {
  onClose: () => void
  lang: 'ja' | 'en'
  backend: 'webgpu' | 'wasm' | null
  recWorkerCount: number
}

export function SettingsModal({ onClose, lang, backend, recWorkerCount }: SettingsModalProps) {
  const [settings, updateSettings] = useSettings()
  const [needsReload, setNeedsReload] = useState(false)
  const ja = lang === 'ja'
  const backendLabel = backend === 'webgpu' ? 'WebGPU' : backend === 'wasm' ? 'WebAssembly (CPU)' : (ja ? '初期化中…' : 'Initializing…')
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)

  const handleClearModels = async () => {
    if (!window.confirm(
      lang === 'ja'
        ? 'キャッシュされたONNXモデルを削除しますか？次回起動時に再ダウンロードが必要です。'
        : 'Delete cached ONNX models? They will be re-downloaded on next startup.'
    )) return

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
          <h2>{lang === 'ja' ? '設定' : 'Settings'}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="panel-body">
          <section className="settings-section">
            <h3>{ja ? '認識・出力オプション' : 'Recognition & Output'}</h3>
            <label className="settings-option">
              <input
                type="checkbox"
                checked={settings.characterInclusion}
                onChange={(e) => updateSettings({ characterInclusion: e.target.checked })}
                data-testid="opt-character-inclusion"
              />
              {ja ? '異体字を新字体に変換して表示・出力する（例: 國→国）' : 'Normalize variant/old-style kanji to modern forms (e.g. 國→国)'}
            </label>
            <label className="settings-option">
              <input
                type="checkbox"
                checked={settings.tableStructure}
                onChange={(e) => updateSettings({ tableStructure: e.target.checked })}
                data-testid="opt-table-structure"
              />
              {ja ? '表の構造を推定する（初回のみ追加モデル約28MBをダウンロード）' : 'Recognize table structure (downloads an extra ~28MB model once)'}
            </label>
            <p className="settings-description settings-note">
              {ja
                ? '表構造の推定結果は「整形表示」とHTML・Markdown出力に反映されます。設定は次の認識から有効です。'
                : 'Table structures appear in the Formatted view and in HTML/Markdown output. Applies to subsequent recognitions.'}
            </p>
          </section>

          <section className="settings-section">
            <h3>{ja ? '処理性能' : 'Performance'}</h3>
            <p className="settings-description">
              {ja ? 'レイアウト認識の実行方式' : 'Layout detection backend'}: <strong data-testid="backend-label">{backendLabel}</strong>
              {' / '}
              {ja ? '文字認識スレッド数' : 'Recognition threads'}: <strong>{recWorkerCount === 0 ? (ja ? '1（省メモリモード）' : '1 (low-memory mode)') : recWorkerCount}</strong>
            </p>
            <label className="settings-option">
              <input
                type="checkbox"
                checked={settings.backend === 'wasm'}
                onChange={(e) => { updateSettings({ backend: e.target.checked ? 'wasm' : 'auto' }); setNeedsReload(true) }}
              />
              {ja ? 'WebGPUを使用しない（表示や結果に問題がある場合）' : 'Disable WebGPU (if you experience problems)'}
            </label>
            <label className="settings-option">
              {ja ? '文字認識スレッド数' : 'Recognition threads'}{' '}
              <select
                value={settings.recWorkers}
                onChange={(e) => { updateSettings({ recWorkers: Number(e.target.value) }); setNeedsReload(true) }}
              >
                <option value={0}>{ja ? '自動' : 'Auto'}</option>
                {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <p className="settings-description settings-note">
              {ja
                ? 'スレッド数を増やすと速くなりますが、1スレッドあたり約300MBのメモリを使用します。'
                : 'More threads are faster but each uses about 300MB of memory.'}
            </p>
            {needsReload && (
              <button className="btn btn-primary" onClick={() => location.reload()}>
                {ja ? '再読み込みして反映' : 'Reload to apply'}
              </button>
            )}
          </section>

          <section className="settings-section">
            <h3>{lang === 'ja' ? 'モデルキャッシュ' : 'Model Cache'}</h3>
            <p className="settings-description">
              {lang === 'ja'
                ? 'ダウンロード済みのONNXモデルはIndexedDBにキャッシュされています。キャッシュをクリアすると次回起動時に再ダウンロードが必要です。'
                : 'Downloaded ONNX models are cached in IndexedDB. Clearing the cache requires re-downloading on next startup.'}
            </p>
            <button
              className="btn btn-secondary"
              onClick={handleClearModels}
              disabled={clearing}
            >
              {cleared
                ? (lang === 'ja' ? '✓ クリア完了' : '✓ Cleared')
                : clearing
                  ? (lang === 'ja' ? 'クリア中...' : 'Clearing...')
                  : (lang === 'ja' ? 'モデルキャッシュをクリア' : 'Clear Model Cache')}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
