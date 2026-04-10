/**
 * textExport ユーティリティテスト
 * DOM API のモック使用
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// DOM グローバルのモック（Node環境で document が存在しないため）
const mockAnchor = { href: '', download: '', click: vi.fn() }

vi.stubGlobal('document', {
  createElement: vi.fn(() => ({ ...mockAnchor, click: vi.fn() })),
})

// URL コンストラクタを保持しつつ静的メソッドだけモック
const OriginalURL = globalThis.URL
vi.stubGlobal('URL', Object.assign(
  function (...args: ConstructorParameters<typeof OriginalURL>) { return new OriginalURL(...args) },
  {
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
    prototype: OriginalURL.prototype,
  }
))

// import はモック定義後に行う
const { downloadText, copyToClipboard } = await import('../../src/utils/textExport')

// ============================================================
// downloadText
// ============================================================
describe('downloadText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('click と revokeObjectURL が呼ばれる', () => {
    const anchor = { href: '', download: '', click: vi.fn() }
    vi.mocked(document.createElement).mockReturnValue(anchor as unknown as HTMLAnchorElement)

    downloadText('hello world', 'test-image.png')

    expect(anchor.click).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('ファイル拡張子を除去して _ocr.txt を付ける', () => {
    const anchor = { href: '', download: '', click: vi.fn() }
    vi.mocked(document.createElement).mockReturnValue(anchor as unknown as HTMLAnchorElement)

    downloadText('content', 'document.pdf')
    expect(anchor.download).toBe('document_ocr.txt')
  })

  it('拡張子なしのファイル名もそのまま _ocr.txt を付ける', () => {
    const anchor = { href: '', download: '', click: vi.fn() }
    vi.mocked(document.createElement).mockReturnValue(anchor as unknown as HTMLAnchorElement)

    downloadText('content', 'noext')
    expect(anchor.download).toBe('noext_ocr.txt')
  })

  it('Blob に UTF-8 テキストが含まれる', () => {
    const anchor = { href: '', download: '', click: vi.fn() }
    vi.mocked(document.createElement).mockReturnValue(anchor as unknown as HTMLAnchorElement)

    downloadText('日本語テスト', 'test.png')

    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('text/plain;charset=utf-8')
  })
})

// ============================================================
// copyToClipboard
// ============================================================
describe('copyToClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('navigator.clipboard.writeText を呼ぶ', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } })

    await copyToClipboard('test text')
    expect(writeTextSpy).toHaveBeenCalledWith('test text')
  })

  it('日本語テキストを正しくコピー', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } })

    await copyToClipboard('こんにちは世界')
    expect(writeTextSpy).toHaveBeenCalledWith('こんにちは世界')
  })
})
