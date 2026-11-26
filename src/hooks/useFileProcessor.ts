import { useState, useCallback } from 'react'
import type { ProcessedImage } from '../types/ocr'
import { fileToProcessedImage, tiffToProcessedImages, isTiffFile, isHeicFile } from '../utils/imageLoader'
import { pdfToProcessedImages } from '../utils/pdfLoader'

export interface FileLoadingState {
  fileName: string
  currentPage: number | null
  totalPages: number | null
}

/** ファイル（画像 / PDF / TIFF / HEIC）を読み込んで ProcessedImage の配列にする */
export function useFileProcessor() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileLoadingState, setFileLoadingState] = useState<FileLoadingState | null>(null)

  const processFiles = useCallback(async (files: File[]): Promise<ProcessedImage[]> => {
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
        } else if (isTiffFile(file)) {
          setFileLoadingState({ fileName: file.name, currentPage: null, totalPages: null })
          const pages = await tiffToProcessedImages(file)
          images.push(...pages)
        } else if (file.type.startsWith('image/') || isHeicFile(file)) {
          setFileLoadingState({ fileName: file.name, currentPage: null, totalPages: null })
          const img = await fileToProcessedImage(file)
          images.push(img)
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
      setFileLoadingState(null)
    }
    return images
  }, [])

  return { isLoading, error, processFiles, fileLoadingState }
}
