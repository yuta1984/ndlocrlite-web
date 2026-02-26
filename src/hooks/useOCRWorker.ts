import { useRef, useState, useCallback, useEffect } from 'react'
import type { OCRJobState, OCRResult, ProcessedImage, TextBlock } from '../types/ocr'
import type { WorkerInMessage, WorkerOutMessage } from '../types/worker'
import { imageDataToDataUrl } from '../utils/imageLoader'

const initialJobState: OCRJobState = {
  status: 'idle',
  currentFile: '',
  currentFileIndex: 0,
  totalFiles: 0,
  stageProgress: 0,
  stage: '',
  message: '',
}

export function useOCRWorker() {
  const workerRef = useRef<Worker | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [jobState, setJobState] = useState<OCRJobState>(initialJobState)

  // Worker起動
  useEffect(() => {
    const worker = new Worker(
      new URL('../worker/ocr.worker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker

    // 初期化メッセージ送信
    worker.postMessage({ type: 'INITIALIZE' })

    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data
      if (msg.type === 'OCR_PROGRESS') {
        if (msg.stage === 'initialized') {
          setIsReady(true)
          setJobState(initialJobState)
        } else {
          setJobState((prev) => ({
            ...prev,
            status: 'loading_model',
            stageProgress: msg.progress,
            stage: msg.stage,
            message: msg.message,
            modelProgress: msg.modelProgress,
          }))
        }
      }
    }

    return () => {
      worker.postMessage({ type: 'TERMINATE' })
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const processImage = useCallback(
    (image: ProcessedImage, fileIndex: number, totalFiles: number): Promise<OCRResult> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('Worker not initialized'))
          return
        }

        const id = `${Date.now()}-${fileIndex}`

        setJobState({
          status: 'processing',
          currentFile: image.fileName,
          currentFileIndex: fileIndex + 1,
          totalFiles,
          stageProgress: 0,
          stage: 'starting',
          message: '',
        })

        const handler = (event: MessageEvent<WorkerOutMessage>) => {
          const msg = event.data
          if (msg.id !== undefined && msg.id !== id) return

          if (msg.type === 'OCR_PROGRESS') {
            setJobState((prev) => ({
              ...prev,
              stageProgress: msg.progress,
              stage: msg.stage,
              message: msg.message,
              status: msg.stage === 'initialized' ? 'idle' : 'processing',
              modelProgress: msg.modelProgress,
            }))
          } else if (msg.type === 'OCR_COMPLETE') {
            workerRef.current?.removeEventListener('message', handler)
            const result: OCRResult = {
              id,
              fileName: image.pageIndex
                ? `${image.fileName} (p.${image.pageIndex})`
                : image.fileName,
              imageDataUrl: imageDataToDataUrl(image.imageData),
              textBlocks: msg.textBlocks,
              fullText: msg.txt,
              processingTimeMs: msg.processingTime,
              createdAt: Date.now(),
            }
            setJobState((prev) => ({ ...prev, status: 'done', stageProgress: 1 }))
            resolve(result)
          } else if (msg.type === 'OCR_ERROR') {
            workerRef.current?.removeEventListener('message', handler)
            setJobState((prev) => ({
              ...prev,
              status: 'error',
              errorMessage: msg.error,
            }))
            reject(new Error(msg.error))
          }
        }

        workerRef.current.addEventListener('message', handler)
        workerRef.current.postMessage({
          type: 'OCR_PROCESS',
          id,
          imageData: image.imageData,
          startTime: Date.now(),
        })
      })
    },
    []
  )

  const processRegion = useCallback(
    (imageData: ImageData): Promise<{ textBlocks: TextBlock[]; fullText: string }> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('Worker not initialized'))
          return
        }

        const id = `region-${Date.now()}`

        const handler = (event: MessageEvent<WorkerOutMessage>) => {
          const msg = event.data
          if (msg.id !== id) return  // 他ジョブのメッセージを無視

          if (msg.type === 'OCR_COMPLETE') {
            workerRef.current?.removeEventListener('message', handler)
            resolve({ textBlocks: msg.textBlocks, fullText: msg.txt })
          } else if (msg.type === 'OCR_ERROR') {
            workerRef.current?.removeEventListener('message', handler)
            reject(new Error(msg.error))
          }
          // OCR_PROGRESS は意図的に無視（jobState に影響させない）
        }

        workerRef.current.addEventListener('message', handler)
        workerRef.current.postMessage(
          { type: 'OCR_PROCESS', id, imageData, startTime: Date.now() } satisfies WorkerInMessage,
          [imageData.data.buffer]  // Transferable でゼロコピー転送
        )
      })
    },
    []
  )

  const resetState = useCallback(() => {
    setJobState(initialJobState)
  }, [])

  return { isReady, jobState, processImage, processRegion, resetState }
}
