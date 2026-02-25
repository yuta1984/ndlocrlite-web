import { useState, useEffect, useCallback } from 'react'
import type { OCRResult, TextBlock } from './types/ocr'
import type { DBRunEntry } from './types/db'
import { useI18n } from './hooks/useI18n'
import { useOCRWorker } from './hooks/useOCRWorker'
import { useFileProcessor } from './hooks/useFileProcessor'
import { useResultCache } from './hooks/useResultCache'
import { Header } from './components/layout/Header'
import { Footer } from './components/layout/Footer'
import { FileDropZone } from './components/upload/FileDropZone'
import { DirectoryPicker } from './components/upload/DirectoryPicker'
import { ProgressBar } from './components/progress/ProgressBar'
import { ImageViewer } from './components/viewer/ImageViewer'
import { ResultPanel } from './components/results/ResultPanel'
import { ResultActions } from './components/results/ResultActions'
import { HistoryPanel } from './components/results/HistoryPanel'
import { SettingsModal } from './components/settings/SettingsModal'
import './App.css'

export default function App() {
  const { lang, toggleLanguage } = useI18n()
  const { isReady, jobState, processImage, resetState } = useOCRWorker()
  const { processedImages, isLoading: isLoadingFiles, processFiles, clearImages } = useFileProcessor()
  const { runs: historyRuns, saveRun, clearResults } = useResultCache()

  const [sessionResults, setSessionResults] = useState<OCRResult[]>([])
  const [selectedResultIndex, setSelectedResultIndex] = useState(0)
  const [selectedBlock, setSelectedBlock] = useState<TextBlock | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const currentResult = sessionResults[selectedResultIndex] ?? null

  const handleFilesSelected = useCallback(async (files: File[]) => {
    await processFiles(files)
  }, [processFiles])

  const handleSampleLoad = useCallback(async () => {
    const res = await fetch('/kumonoito.png')
    const blob = await res.blob()
    const file = new File([blob], 'kumonoito.png', { type: 'image/png' })
    await processFiles([file])
  }, [processFiles])

  // processedImages更新時に自動でOCR開始
  useEffect(() => {
    if (processedImages.length === 0 || isProcessing) return

    const runOCR = async () => {
      setIsProcessing(true)
      setSessionResults([])
      setSelectedResultIndex(0)
      resetState()

      const runId = crypto.randomUUID()
      const runCreatedAt = Date.now()
      const successItems: Array<{ result: OCRResult; thumbnailDataUrl: string }> = []
      const sessionResultsAccum: OCRResult[] = []

      for (let i = 0; i < processedImages.length; i++) {
        const image = processedImages[i]
        try {
          const result = await processImage(image, i, processedImages.length)
          successItems.push({ result, thumbnailDataUrl: image.thumbnailDataUrl })
          sessionResultsAccum.push(result)
          setSessionResults([...sessionResultsAccum])
          setSelectedResultIndex(sessionResultsAccum.length - 1)
        } catch (err) {
          console.error(`OCR failed for ${image.fileName}:`, err)
        }
      }

      if (successItems.length > 0) {
        const runEntry: DBRunEntry = {
          id: runId,
          files: successItems.map(({ result, thumbnailDataUrl }) => ({
            fileName: result.fileName,
            imageDataUrl: thumbnailDataUrl,
            textBlocks: result.textBlocks,
            fullText: result.fullText,
            processingTimeMs: result.processingTimeMs,
          })),
          createdAt: runCreatedAt,
        }
        await saveRun(runEntry)
      }

      setIsProcessing(false)
    }

    runOCR()
  }, [processedImages]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = () => {
    clearImages()
    setSessionResults([])
    setSelectedResultIndex(0)
    setSelectedBlock(null)
    resetState()
    setIsProcessing(false)
  }

  const handleHistorySelect = (run: DBRunEntry) => {
    const restoredResults: OCRResult[] = run.files.map((file, i) => ({
      id: `${run.id}-${i}`,
      fileName: file.fileName,
      imageDataUrl: file.imageDataUrl,
      textBlocks: file.textBlocks,
      fullText: file.fullText,
      processingTimeMs: file.processingTimeMs,
      createdAt: run.createdAt,
    }))
    setSessionResults(restoredResults)
    setSelectedResultIndex(0)
    setSelectedBlock(null)
    setShowHistory(false)
  }

  const isWorking = isLoadingFiles || isProcessing
  const hasResults = sessionResults.length > 0

  return (
    <div className="app">
      <Header
        lang={lang}
        onToggleLanguage={toggleLanguage}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHistory={() => setShowHistory(true)}
      />

      <main className="main">
        {!hasResults && !isWorking && (
          <section className="upload-section">
            <FileDropZone onFilesSelected={handleFilesSelected} lang={lang} disabled={isWorking} />
            <div className="upload-actions">
              <DirectoryPicker onFilesSelected={handleFilesSelected} lang={lang} disabled={isWorking} />
              <button className="btn btn-secondary" onClick={handleSampleLoad} disabled={isWorking}>
                {lang === 'ja' ? 'サンプルを試す' : 'Try Sample'}
              </button>
            </div>
          </section>
        )}

        {isWorking && (
          <div className="processing-section">
            <ProgressBar jobState={jobState} lang={lang} />
            {!isReady && (
              <p className="model-loading-note">
                {lang === 'ja'
                  ? '初回起動時はモデルのダウンロードに時間がかかります（数分程度）。次回以降はキャッシュから高速起動します。'
                  : 'First run requires model download (may take a few minutes). Subsequent runs will use the cached model.'}
              </p>
            )}
          </div>
        )}

        {hasResults && (
          <section className="result-section">
            {/* 左サイドバー: ファイル一覧 */}
            {sessionResults.length > 1 && (
              <div className="result-sidebar">
                {sessionResults.map((result, i) => (
                  <button
                    key={result.id}
                    className={`result-sidebar-item ${i === selectedResultIndex ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedResultIndex(i)
                      setSelectedBlock(null)
                    }}
                    title={result.fileName}
                  >
                    <img src={result.imageDataUrl} alt={result.fileName} />
                    <span className="result-sidebar-label">{result.fileName}</span>
                  </button>
                ))}
              </div>
            )}

            {/* メインコンテンツ */}
            <div className="result-content">
              {/* ページナビゲーション */}
              <div className="result-page-nav">
                <button
                  className="btn-nav"
                  onClick={() => { setSelectedResultIndex(prev => prev - 1); setSelectedBlock(null) }}
                  disabled={selectedResultIndex === 0}
                  title={lang === 'ja' ? '前のファイル' : 'Previous file'}
                >
                  ←
                </button>
                <select
                  className="result-page-select"
                  value={selectedResultIndex}
                  onChange={(e) => {
                    setSelectedResultIndex(Number(e.target.value))
                    setSelectedBlock(null)
                  }}
                >
                  {sessionResults.map((result, i) => (
                    <option key={result.id} value={i}>
                      {i + 1} / {sessionResults.length}　{result.fileName}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-nav"
                  onClick={() => { setSelectedResultIndex(prev => prev + 1); setSelectedBlock(null) }}
                  disabled={selectedResultIndex === sessionResults.length - 1}
                  title={lang === 'ja' ? '次のファイル' : 'Next file'}
                >
                  →
                </button>
              </div>

              <div className="result-main">
                <div className="result-left">
                  {currentResult && (
                    <ImageViewer
                      imageDataUrl={currentResult.imageDataUrl}
                      textBlocks={currentResult.textBlocks}
                      selectedBlock={selectedBlock}
                      onBlockSelect={setSelectedBlock}
                      onRegionSelect={(blocks) => {
                        if (blocks.length > 0) setSelectedBlock(blocks[0])
                      }}
                    />
                  )}
                </div>

                <div className="result-right">
                  <ResultPanel result={currentResult} selectedBlock={selectedBlock} lang={lang} />
                  <ResultActions results={sessionResults} currentResult={currentResult} lang={lang} />
                </div>
              </div>

              <div className="new-process-section">
                <button className="btn btn-primary" onClick={handleClear}>
                  {lang === 'ja' ? '新しいファイルを処理' : 'Process New Files'}
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      <Footer lang={lang} />

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
        <SettingsModal onClose={() => setShowSettings(false)} lang={lang} />
      )}
    </div>
  )
}
