import type { PageBlock, TextBlock } from '../../types/ocr'
import type { OcrDocument } from '../../state/documents'
import { ResultPanel } from '../results/ResultPanel'
import { ResultActions } from '../results/ResultActions'

interface TextPaneProps {
  lang: 'ja' | 'en'
  doc: OcrDocument | null
  selectedBlock: TextBlock | null
  selectedPageBlock: PageBlock | null
  selectedPageBlockText: string | null
  busy: boolean
  onRecognize: (id: string) => void
}

/** メインコンテンツ右: 認識テキスト（未認識の場合は案内と「この画像を認識」ボタン） */
export function TextPane({ lang, doc, selectedBlock, selectedPageBlockText, busy, onRecognize }: TextPaneProps) {
  const ja = lang === 'ja'

  let placeholder: React.ReactNode = null
  if (!doc) {
    placeholder = <p>{ja ? '画像を追加して選択すると、ここに認識結果が表示されます' : 'Add and select an image to see the recognized text here'}</p>
  } else if (doc.status === 'processing') {
    placeholder = <p><span className="file-loading-spinner" /> {ja ? '認識中…' : 'Recognizing…'}</p>
  } else if (!doc.result) {
    placeholder = (
      <>
        {doc.status === 'error' && <p className="text-pane-error">{ja ? '認識に失敗しました' : 'Recognition failed'}: {doc.error}</p>}
        <p>{ja ? 'まだ認識していません' : 'Not recognized yet'}</p>
        <button className="btn btn-primary" onClick={() => onRecognize(doc.id)} disabled={busy}>
          {ja ? 'この画像を認識' : 'Recognize this image'}
        </button>
      </>
    )
  }

  return (
    <section className="text-pane" aria-label={ja ? '認識テキスト' : 'Recognized text'}>
      {placeholder ? (
        <div className="text-pane-placeholder">{placeholder}</div>
      ) : (
        <ResultPanel
          result={doc!.result!}
          selectedBlock={selectedBlock}
          selectedPageBlockText={selectedPageBlockText}
          lang={lang}
        />
      )}
      <ResultActions currentResult={doc?.result ?? null} lang={lang} />
    </section>
  )
}
