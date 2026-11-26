import { useState } from 'react'
import type { BoundingBox, OCRJobState, PageBlock, TextBlock } from '../../types/ocr'
import type { OcrDocument } from '../../state/documents'
import { ImageViewer } from '../viewer/ImageViewer'
import { ProgressBar } from '../progress/ProgressBar'
import { filterAcceptedFiles } from '../../utils/file-accept'

interface ImagePaneProps {
  lang: 'ja' | 'en'
  doc: OcrDocument | null
  imageDataUrl: string
  jobState: OCRJobState
  showProgress: boolean
  selectedBlock: TextBlock | null
  selectedPageBlock: PageBlock | null
  onBlockSelect: (b: TextBlock) => void
  onPageBlockSelect: (b: PageBlock) => void
  onRegionSelect: (blocks: TextBlock[], bbox: BoundingBox) => void
  onAddFiles: (files: File[]) => void
  onOpenAbout: () => void
  /** モバイル: サイドバー（ドロワー）を開く */
  onOpenMenu: () => void
}

/** メインコンテンツ左: 選択中の資料画像（画像がないときは大きなドロップエリア） */
export function ImagePane({
  lang, doc, imageDataUrl, jobState, showProgress, selectedBlock, selectedPageBlock,
  onBlockSelect, onPageBlockSelect, onRegionSelect, onAddFiles, onOpenAbout, onOpenMenu,
}: ImagePaneProps) {
  const ja = lang === 'ja'
  const [dragging, setDragging] = useState(false)
  const result = doc?.result

  return (
    <section
      className={`image-pane ${dragging ? 'dragging' : ''}`}
      aria-label={ja ? '資料画像' : 'Page image'}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragging(false)
        const files = filterAcceptedFiles(e.dataTransfer.files)
        if (files.length > 0) onAddFiles(files)
      }}
    >
      {showProgress && (
        <div className="pane-progress">
          <ProgressBar jobState={jobState} lang={lang} />
        </div>
      )}

      {doc ? (
        <>
          <div className="image-pane-title">
            <span className="image-pane-name" title={doc.name}>{doc.name}</span>
          </div>
          <div className="image-pane-canvas">
            <ImageViewer
              imageDataUrl={imageDataUrl}
              textBlocks={result?.textBlocks ?? []}
              selectedBlock={selectedBlock}
              onBlockSelect={onBlockSelect}
              onRegionSelect={onRegionSelect}
              pageBlocks={result?.pageBlocks}
              selectedPageBlock={selectedPageBlock}
              onPageBlockSelect={onPageBlockSelect}
            />
          </div>
          <p className="region-select-hint">
            {ja ? 'マウスで領域をドラッグすると、その領域のみ認識をおこないます' : 'Drag to select a region and run OCR on that area only'}
          </p>
        </>
      ) : (
        <div className="image-pane-empty">
          <div className="image-pane-empty-icon" aria-hidden>📄</div>
          <p className="image-pane-empty-text only-desktop">
            {ja
              ? '画像をここにドラッグ＆ドロップ、または左の「ファイルを追加」から読み込んでください'
              : 'Drop images here, or use "Add files" on the left'}
          </p>
          <button className="btn btn-primary only-mobile" onClick={onOpenMenu}>
            {ja ? '＋ 画像を追加' : '+ Add images'}
          </button>
          <p className="image-pane-empty-formats">JPG / PNG / TIFF / HEIC / PDF · {ja ? 'Ctrl+V で貼り付け可' : 'Ctrl+V to paste'}</p>
          <p className="image-pane-empty-privacy">
            🔒 {ja
              ? '処理はすべてブラウザ内で完結し、画像とOCR結果は外部に送信されません。'
              : 'Everything runs in your browser. Images and OCR results are never sent anywhere.'}{' '}
            <button className="btn-text" onClick={onOpenAbout}>{ja ? 'このアプリについて' : 'About'}</button>
          </p>
        </div>
      )}
    </section>
  )
}
