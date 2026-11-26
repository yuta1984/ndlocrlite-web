/** OCR 対象として受け付けるファイル（画像 / PDF / TIFF / HEIC） */
export const ACCEPT_ATTR =
  'image/jpeg,image/png,image/webp,image/tiff,image/heic,image/heif,.tif,.tiff,.heic,.heif,application/pdf'

export function isAcceptedFile(f: File): boolean {
  if (f.type === 'application/pdf' || f.type.startsWith('image/')) return true
  const ext = f.name.toLowerCase().split('.').pop()
  return ['tif', 'tiff', 'heic', 'heif', 'pdf'].includes(ext ?? '')
}

export function filterAcceptedFiles(files: FileList | File[] | null | undefined): File[] {
  return files ? Array.from(files).filter(isAcceptedFile) : []
}
