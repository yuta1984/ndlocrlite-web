/**
 * テキストのダウンロード・クリップボードコピー
 */

export type ExportFormat = 'txt' | 'paragraph' | 'md' | 'html' | 'json' | 'xml'

export const EXPORT_FORMATS: Record<ExportFormat, { ext: string; mime: string; suffix: string }> = {
  txt: { ext: 'txt', mime: 'text/plain', suffix: '_ocr' },
  paragraph: { ext: 'txt', mime: 'text/plain', suffix: '_ocr_paragraph' },
  md: { ext: 'md', mime: 'text/markdown', suffix: '_ocr' },
  html: { ext: 'html', mime: 'text/html', suffix: '_ocr' },
  json: { ext: 'json', mime: 'application/json', suffix: '_ocr' },
  xml: { ext: 'xml', mime: 'application/xml', suffix: '_ocr' },
}

export function downloadFile(content: string, fileName: string, format: ExportFormat = 'txt'): void {
  const { ext, mime, suffix } = EXPORT_FORMATS[format]
  const baseName = fileName.replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|]/g, '_')
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName}${suffix}.${ext}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 後方互換: テキストを .txt としてダウンロード */
export function downloadText(text: string, fileName: string): void {
  downloadFile(text, fileName, 'txt')
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}
