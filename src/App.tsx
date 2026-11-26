import { useState, useEffect, useCallback, useMemo } from 'react'
import type { TextBlock, BoundingBox, PageBlock, OCRResult } from './types/ocr'
import type { DBRunEntry } from './types/db'
import { useI18n } from './hooks/useI18n'
import { useOCRWorker } from './hooks/useOCRWorker'
import { useFileProcessor } from './hooks/useFileProcessor'
import { useResultCache } from './hooks/useResultCache'
import { useDocuments } from './hooks/useDocuments'
import { useResultPanelWidth } from './hooks/useResultPanelWidth'
import { useTextTransform } from './hooks/useTextTransform'
import { selectedDocument, completedResults } from './state/documents'
import { Header } from './components/layout/Header'
import { AboutModal } from './components/layout/AboutModal'
import { TechInfoModal } from './components/layout/TechInfoModal'
import { ResizeHandle } from './components/layout/ResizeHandle'
import { Sidebar, type SampleDef } from './components/sidebar/Sidebar'
import { ImagePane } from './components/workspace/ImagePane'
import { TextPane } from './components/workspace/TextPane'
import { HistoryPanel } from './components/results/HistoryPanel'
import { SettingsModal } from './components/settings/SettingsModal'
import { RegionOCRDialog } from './components/viewer/RegionOCRDialog'
import { imageDataToDataUrl } from './utils/imageLoader'
import { filterAcceptedFiles } from './utils/file-accept'
import { buildExport } from './utils/export-builder'
import { downloadFile } from './utils/textExport'
import { getSettings } from './utils/settings'
import './App.css'

const SAMPLES: SampleDef[] = [
  {
    url: '/kumonoito.png',
    fileName: 'kumonoito.png',
    type: 'image/png',
    title: { ja: '縦書きの本文（芥川龍之介「蜘蛛の糸」）', en: 'Vertical Japanese text (Akutagawa, "The Spider\'s Thread")' },
  },
  {
    url: '/samples/digidepo_3048008_0025.jpg',
    fileName: 'digidepo_3048008_0025.jpg',
    type: 'image/jpeg',
    title: {
      ja: '表を含むページ（国立国会図書館デジタルコレクションより。NDLOCR-Lite 同梱サンプル）',
      en: 'Page with a table (NDL Digital Collections; sample bundled with NDLOCR-Lite)',
    },
  },
]

type MobileTab = 'image' | 'text'

function cropRegion(srcDataUrl: string, bbox: BoundingBox) {
  return new Promise<{ previewDataUrl: string; imageData: ImageData }>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const w = Math.max(1, Math.round(bbox.width))
      const h = Math.max(1, Math.round(bbox.height))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, w, h)
      resolve({
        previewDataUrl: canvas.toDataURL('image/jpeg', 0.9),
        imageData: ctx.getImageData(0, 0, w, h),
      })
    }
    img.src = srcDataUrl
  })
}

export default function App() {
  const { lang, toggleLanguage } = useI18n()
  const { isReady, backend, recWorkerCount, jobState, processImage, processRegion } = useOCRWorker()
  const { isLoading: isLoadingFiles, processFiles, fileLoadingState } = useFileProcessor()
  const { runs: historyRuns, saveRun, clearResults } = useResultCache()
  const documents = useDocuments(processImage, saveRun)
  const { state: docState, isRecognizing } = documents
  const [resultPanelWidth, setResultPanelWidth] = useResultPanelWidth()
  const transform = useTextTransform()

  const [selectedBlock, setSelectedBlock] = useState<TextBlock | null>(null)
  const [selectedPageBlock, setSelectedPageBlock] = useState<PageBlock | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showTechInfo, setShowTechInfo] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mobileTab, setMobileTab] = useState<MobileTab>('image')
  const [regionOCRDialog, setRegionOCRDialog] = useState<{
    cropDataUrl: string
    isProcessing: boolean
    result: { textBlocks: TextBlock[]; fullText: string } | null
  } | null>(null)

  const currentDoc = selectedDocument(docState)
  const busy = isLoadingFiles || isRecognizing

  // 選択が変わったら行・ブロックの選択を解除（レンダー中に前回値と比較）
  const [prevSelectedId, setPrevSelectedId] = useState(docState.selectedId)
  if (prevSelectedId !== docState.selectedId) {
    setPrevSelectedId(docState.selectedId)
    setSelectedBlock(null)
    setSelectedPageBlock(null)
  }

  // ビューアに表示する画像（元画像があればフル解像度、履歴から復元した資料はサムネイル）
  const currentImage = currentDoc?.image ?? null
  const currentImageDataUrl = useMemo(
    () => (currentImage ? imageDataToDataUrl(currentImage.imageData) : currentDoc?.result?.imageDataUrl ?? ''),
    [currentImage, currentDoc?.result?.imageDataUrl]
  )

  // 元ページのサイズ（領域OCRで切り出し画像を同じ縮尺の白地に置くため。履歴から復元した資料は保存済みのサイズ）
  const resultWidth = currentDoc?.result?.imageWidth
  const resultHeight = currentDoc?.result?.imageHeight
  const currentPageSize = useMemo(() => {
    if (currentImage) return { width: currentImage.imageData.width, height: currentImage.imageData.height }
    if (resultWidth && resultHeight) return { width: resultWidth, height: resultHeight }
    return undefined
  }, [currentImage, resultWidth, resultHeight])

  const selectedPageBlockText = useMemo(() => {
    const result = currentDoc?.result
    if (!selectedPageBlock || !result) return null
    const cx = (b: TextBlock) => b.x + b.width / 2
    const cy = (b: TextBlock) => b.y + b.height / 2
    return result.textBlocks
      .filter(b =>
        cx(b) >= selectedPageBlock.x && cx(b) <= selectedPageBlock.x + selectedPageBlock.width &&
        cy(b) >= selectedPageBlock.y && cy(b) <= selectedPageBlock.y + selectedPageBlock.height
      )
      .sort((a, b) => a.readingOrder - b.readingOrder)
      .map(b => b.text)
      .join('\n')
  }, [selectedPageBlock, currentDoc?.result])

  const { addImages } = documents
  const handleAddFiles = useCallback(async (files: File[]) => {
    const images = await processFiles(files)
    addImages(images)
    setMobileTab('image')
    setSidebarOpen(false)
  }, [processFiles, addImages])

  const handleSample = useCallback(async (sample: SampleDef) => {
    const blob = await (await fetch(sample.url)).blob()
    await handleAddFiles([new File([blob], sample.fileName, { type: sample.type })])
  }, [handleAddFiles])

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read()
      const files: File[] = []
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type)
            const ext = type.split('/')[1] || 'png'
            files.push(new File([blob], `clipboard.${ext}`, { type }))
          }
        }
      }
      if (files.length > 0) await handleAddFiles(files)
    } catch {
      // permission denied or no image in clipboard — ignore silently
    }
  }, [handleAddFiles])

  // Ctrl+V / Cmd+V でクリップボードの画像を追加（入力欄にフォーカスがあるときは除く）
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (busy) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const files: File[] = []
      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length > 0) handleAddFiles(files)
    }
    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [busy, handleAddFiles])

  // 画面のどこにドロップしても画像を追加できるようにする（ブラウザがファイルを開くのを防ぐ）
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      if (busy) return
      const files = filterAcceptedFiles(e.dataTransfer.files)
      if (files.length > 0) handleAddFiles(files)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [busy, handleAddFiles])

  // ↑↓ キーで資料を切り替え（入力欄・ダイアログ表示中は除く）
  const { selectOffset } = documents
  const anyDialog = showHistory || showSettings || showAbout || showTechInfo || !!regionOCRDialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) { setSidebarOpen(false); return }
      if (anyDialog || e.altKey || e.metaKey || e.ctrlKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="separator"]')) return
      if (e.key === 'ArrowDown') { selectOffset(1); e.preventDefault() }
      else if (e.key === 'ArrowUp') { selectOffset(-1); e.preventDefault() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [anyDialog, selectOffset, sidebarOpen])

  const { recognize } = documents
  const handleRecognizeAll = useCallback(async () => {
    setSidebarOpen(false)
    await recognize()
    setMobileTab('text')
  }, [recognize])

  const handleRecognizeOne = useCallback(async (id: string) => {
    documents.select(id)
    await recognize([id])
    setMobileTab('text')
  }, [recognize, documents])

  const handleDownloadAll = useCallback(() => {
    const results = completedResults(docState)
    if (results.length === 0) return
    const s = getSettings()
    const opts = { format: s.exportFormat, includeFileName: s.includeFileName, ignoreNewlines: s.ignoreNewlines }
    downloadFile(buildExport(results, 'ocr_results', opts, transform), 'ocr_results', s.exportFormat)
  }, [docState, transform])

  const handleClear = useCallback(() => {
    documents.clear()
    setMobileTab('image')
  }, [documents])

  // 領域 OCR（未認識の画像でも可）
  const handleRegionOCR = useCallback(async (blocks: TextBlock[], bbox: BoundingBox) => {
    if (!currentImageDataUrl) return
    if (blocks.length > 0) setSelectedBlock(blocks[0])
    const { previewDataUrl, imageData } = await cropRegion(currentImageDataUrl, bbox)
    setRegionOCRDialog({ cropDataUrl: previewDataUrl, isProcessing: true, result: null })
    try {
      const result = await processRegion(imageData, currentPageSize)
      setRegionOCRDialog(prev => prev ? { ...prev, isProcessing: false, result } : null)
    } catch {
      setRegionOCRDialog(prev => prev ? { ...prev, isProcessing: false, result: { textBlocks: [], fullText: '' } } : null)
    }
  }, [currentImageDataUrl, processRegion, currentPageSize])

  const handleHistorySelect = (run: DBRunEntry) => {
    const restored: OCRResult[] = run.files.map((file, i) => ({
      id: `${run.id}-${i}`,
      fileName: file.fileName,
      imageDataUrl: file.imageDataUrl,
      textBlocks: file.textBlocks,
      fullText: file.fullText,
      processingTimeMs: file.processingTimeMs,
      createdAt: run.createdAt,
      pageBlocks: file.pageBlocks,
      imageWidth: file.imageWidth,
      imageHeight: file.imageHeight,
      tables: file.tables,
    }))
    documents.restore(restored)
    setShowHistory(false)
    setMobileTab('text')
  }

  // 進捗表示: モデル読み込み中、ファイル読み込み中、認識中
  const isModelLoading = jobState.status === 'loading_model'
  const showProgress = isModelLoading || (isRecognizing && jobState.status !== 'idle') || jobState.status === 'error'
  const loadingMessage = isLoadingFiles && fileLoadingState
    ? (fileLoadingState.currentPage != null && fileLoadingState.totalPages != null
      ? (lang === 'ja'
        ? `${fileLoadingState.fileName} を読み込み中 (${fileLoadingState.currentPage}/${fileLoadingState.totalPages})`
        : `Loading ${fileLoadingState.fileName} (${fileLoadingState.currentPage}/${fileLoadingState.totalPages})`)
      : (lang === 'ja' ? `${fileLoadingState.fileName} を読み込み中…` : `Loading ${fileLoadingState.fileName}…`))
    : !isReady && !isModelLoading && jobState.status !== 'error'
      ? (lang === 'ja' ? 'OCRエンジンを準備中…' : 'Preparing OCR engine…')
      : null

  const ja = lang === 'ja'

  return (
    <div className="app">
      <Header
        lang={lang}
        onToggleLanguage={toggleLanguage}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHistory={() => setShowHistory(true)}
        onOpenAbout={() => setShowAbout(true)}
        onOpenTechInfo={() => setShowTechInfo(true)}
        onLogoClick={() => setSidebarOpen(false)}
        onOpenMenu={() => setSidebarOpen(true)}
        menuOpen={sidebarOpen}
      />

      <div className="workspace">
        <Sidebar
          lang={lang}
          docs={docState.docs}
          selectedId={docState.selectedId}
          samples={SAMPLES}
          busy={busy}
          isRecognizing={isRecognizing}
          loadingMessage={loadingMessage}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onAddFiles={handleAddFiles}
          onPaste={handlePasteFromClipboard}
          onSample={handleSample}
          onSelect={documents.select}
          onRecognizeAll={handleRecognizeAll}
          onRecognizeOne={handleRecognizeOne}
          onRemove={documents.remove}
          onDownloadAll={handleDownloadAll}
          onClear={handleClear}
        />

        <main
          className="main-content"
          data-mobile-tab={mobileTab}
          style={{ '--result-panel-width': `${resultPanelWidth}px` } as React.CSSProperties}
        >
          <div className="mobile-tabs" role="tablist" aria-label={ja ? '表示切替' : 'View'}>
            <button role="tab" aria-selected={mobileTab === 'image'} className={mobileTab === 'image' ? 'active' : ''} onClick={() => setMobileTab('image')}>
              {ja ? '画像' : 'Image'}
            </button>
            <button role="tab" aria-selected={mobileTab === 'text'} className={mobileTab === 'text' ? 'active' : ''} onClick={() => setMobileTab('text')}>
              {ja ? 'テキスト' : 'Text'}
              {currentDoc?.status === 'done' && <span className="mobile-tab-dot" aria-hidden />}
            </button>
          </div>

          <ImagePane
            lang={lang}
            doc={currentDoc}
            imageDataUrl={currentImageDataUrl}
            jobState={jobState}
            showProgress={showProgress}
            selectedBlock={selectedBlock}
            selectedPageBlock={selectedPageBlock}
            onBlockSelect={(block) => { setSelectedBlock(block); setSelectedPageBlock(null) }}
            onPageBlockSelect={(block) => { setSelectedPageBlock(block); setSelectedBlock(null) }}
            onRegionSelect={handleRegionOCR}
            onAddFiles={handleAddFiles}
            onOpenAbout={() => setShowAbout(true)}
            onOpenMenu={() => setSidebarOpen(true)}
          />

          <ResizeHandle width={resultPanelWidth} onChange={setResultPanelWidth} lang={lang} />

          <TextPane
            lang={lang}
            doc={currentDoc}
            selectedBlock={selectedBlock}
            selectedPageBlock={selectedPageBlock}
            selectedPageBlockText={selectedPageBlockText}
            busy={busy}
            onRecognize={handleRecognizeOne}
          />

          {/* モバイル: 画像タブの下部操作バー */}
          {docState.docs.length > 0 && (
            <div className="mobile-actionbar">
              <button
                className="btn btn-primary"
                onClick={handleRecognizeAll}
                disabled={busy || !docState.docs.some((d) => d.image && (d.status === 'pending' || d.status === 'error'))}
              >
                {isRecognizing ? (ja ? '認識中…' : 'Recognizing…') : (ja ? '認識を開始' : 'Recognize')}
              </button>
              <button className="btn btn-secondary" onClick={() => setSidebarOpen(true)}>
                {ja ? `画像一覧（${docState.docs.length}）` : `Images (${docState.docs.length})`}
              </button>
            </div>
          )}
        </main>
      </div>

      {showHistory && (
        <HistoryPanel
          runs={historyRuns}
          onSelect={handleHistorySelect}
          onClear={clearResults}
          onClose={() => setShowHistory(false)}
          lang={lang}
        />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} lang={lang} backend={backend} recWorkerCount={recWorkerCount} />
      )}
      {showAbout && <AboutModal lang={lang} onClose={() => setShowAbout(false)} />}
      {showTechInfo && (
        <TechInfoModal lang={lang} onClose={() => setShowTechInfo(false)} backend={backend} recWorkerCount={recWorkerCount} />
      )}
      {regionOCRDialog && (
        <RegionOCRDialog
          cropDataUrl={regionOCRDialog.cropDataUrl}
          isProcessing={regionOCRDialog.isProcessing}
          result={regionOCRDialog.result}
          lang={lang}
          onClose={() => setRegionOCRDialog(null)}
        />
      )}
    </div>
  )
}
