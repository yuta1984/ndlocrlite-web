import { useState, useCallback } from 'react'
import type { ProcessedImage } from '../types/ocr'
import { fileToProcessedImage } from '../utils/imageLoader'
import { pdfToProcessedImages } from '../utils/pdfLoader'

export interface FileLoadingState {
  fileName: string
  currentPage: number | null
  totalPages: number | null
}

export function useFileProcessor() {
  const [processedImages, setProcessedImages] = useState<ProcessedImage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileLoadingState, setFileLoadingState] = useState<FileLoadingState | null>(null)

  const processFiles = useCallback(async (files: File[]) => {
    setIsLoading(true)
    setError(null)

    const images: ProcessedImage[] = []

    try {
      for (const file of files) {
        if (file.type === 'application/pdf') {
          setFileLoadingState({ fileName: file.name, currentPage: null, totalPages: null })
          const pages = await pdfToProcessedImages(file, 2.0, (current, total) => {
            setFileLoadingState({ fileName: file.name, currentPage: current, totalPages: total })
          })
          images.push(...pages)
        } else if (file.type.startsWith('image/')) {
          setFileLoadingState({ fileName: file.name, currentPage: null, totalPages: null })
          const img = await fileToProcessedImage(file)
          images.push(img)
        }
      }
      setProcessedImages(images)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
      setFileLoadingState(null)
    }
  }, [])

  const clearImages = useCallback(() => {
    setProcessedImages([])
    setError(null)
  }, [])

  return { processedImages, isLoading, error, processFiles, clearImages, fileLoadingState }
}
