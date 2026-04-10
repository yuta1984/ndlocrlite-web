/**
 * useFileProcessor フックテスト
 * imageLoader と pdfLoader をモック
 * @vitest-environment jsdom
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ProcessedImage } from '../../src/types/ocr'

// imageLoader / pdfLoader のモック
vi.mock('../../src/utils/imageLoader', () => ({
  fileToProcessedImage: vi.fn(),
  tiffToProcessedImages: vi.fn(),
  isTiffFile: vi.fn(() => false),
  isHeicFile: vi.fn(() => false),
}))

vi.mock('../../src/utils/pdfLoader', () => ({
  pdfToProcessedImages: vi.fn(),
}))

import { useFileProcessor } from '../../src/hooks/useFileProcessor'
import { fileToProcessedImage, isTiffFile, isHeicFile, tiffToProcessedImages } from '../../src/utils/imageLoader'
import { pdfToProcessedImages } from '../../src/utils/pdfLoader'

function fakeImageData(): ImageData {
  return {
    data: new Uint8ClampedArray(10 * 10 * 4),
    width: 10,
    height: 10,
    colorSpace: 'srgb' as PredefinedColorSpace,
  }
}

function makeProcessedImage(name: string): ProcessedImage {
  return {
    fileName: name,
    imageData: fakeImageData(),
    thumbnailDataUrl: 'data:image/png;base64,thumb',
  }
}

function makeFile(name: string, type: string): File {
  return new File(['dummy'], name, { type })
}

beforeEach(() => {
  vi.clearAllMocks()
  // TIFF/HEIC テストで mockReturnValue を変更するため、デフォルト値を再設定
  vi.mocked(isTiffFile).mockReturnValue(false)
  vi.mocked(isHeicFile).mockReturnValue(false)
})

describe('useFileProcessor', () => {
  it('初期状態は空', () => {
    const { result } = renderHook(() => useFileProcessor())
    expect(result.current.processedImages).toEqual([])
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.fileLoadingState).toBeNull()
  })

  it('PNG ファイルを処理する', async () => {
    const img = makeProcessedImage('test.png')
    vi.mocked(fileToProcessedImage).mockResolvedValue(img)

    const { result } = renderHook(() => useFileProcessor())

    await act(async () => {
      await result.current.processFiles([makeFile('test.png', 'image/png')])
    })

    expect(result.current.processedImages).toHaveLength(1)
    expect(result.current.processedImages[0].fileName).toBe('test.png')
    expect(result.current.isLoading).toBe(false)
  })

  it('PDF ファイルを処理する', async () => {
    const pages = [makeProcessedImage('doc-p1'), makeProcessedImage('doc-p2')]
    vi.mocked(pdfToProcessedImages).mockResolvedValue(pages)

    const { result } = renderHook(() => useFileProcessor())

    await act(async () => {
      await result.current.processFiles([makeFile('doc.pdf', 'application/pdf')])
    })

    expect(result.current.processedImages).toHaveLength(2)
    expect(pdfToProcessedImages).toHaveBeenCalledOnce()
  })

  it('TIFF ファイルを処理する', async () => {
    vi.mocked(isTiffFile).mockReturnValue(true)
    const pages = [makeProcessedImage('scan-p1')]
    vi.mocked(tiffToProcessedImages).mockResolvedValue(pages)

    const { result } = renderHook(() => useFileProcessor())

    await act(async () => {
      await result.current.processFiles([makeFile('scan.tiff', 'image/tiff')])
    })

    expect(result.current.processedImages).toHaveLength(1)
    expect(tiffToProcessedImages).toHaveBeenCalledOnce()
  })

  it('複数ファイルを一括処理する', async () => {
    vi.mocked(fileToProcessedImage)
      .mockResolvedValueOnce(makeProcessedImage('img1.png'))
      .mockResolvedValueOnce(makeProcessedImage('img2.jpg'))

    const { result } = renderHook(() => useFileProcessor())

    await act(async () => {
      await result.current.processFiles([
        makeFile('img1.png', 'image/png'),
        makeFile('img2.jpg', 'image/jpeg'),
      ])
    })

    expect(result.current.processedImages).toHaveLength(2)
  })

  it('エラー時に error メッセージがセットされる', async () => {
    vi.mocked(fileToProcessedImage).mockRejectedValue(new Error('Invalid image'))

    const { result } = renderHook(() => useFileProcessor())

    await act(async () => {
      await result.current.processFiles([makeFile('bad.png', 'image/png')])
    })

    expect(result.current.error).toBe('Invalid image')
    expect(result.current.isLoading).toBe(false)
  })

  it('clearImages で画像とエラーがクリアされる', async () => {
    vi.mocked(fileToProcessedImage).mockResolvedValue(makeProcessedImage('test.png'))

    const { result } = renderHook(() => useFileProcessor())

    await act(async () => {
      await result.current.processFiles([makeFile('test.png', 'image/png')])
    })
    expect(result.current.processedImages).toHaveLength(1)

    act(() => result.current.clearImages())
    expect(result.current.processedImages).toEqual([])
    expect(result.current.error).toBeNull()
  })
})
