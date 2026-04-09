import { useRef, useState } from 'react'
import type { Language } from '../../i18n'
import { createTranslator } from '../../i18n'

interface FileDropZoneProps {
  onFilesSelected: (files: File[]) => void
  lang: Language
  disabled?: boolean
}

export function FileDropZone({ onFilesSelected, lang, disabled = false }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const t = createTranslator(lang)

  const handleFiles = (files: FileList | null) => {
    if (!files || disabled) return
    const accepted = Array.from(files).filter((f) => {
      if (f.type === 'application/pdf' || f.type.startsWith('image/')) return true
      const ext = f.name.toLowerCase().split('.').pop()
      return ['tif', 'tiff', 'heic', 'heif'].includes(ext ?? '')
    })
    if (accepted.length > 0) onFilesSelected(accepted)
  }

  return (
    <div
      className={`dropzone ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
    >
      <div className="dropzone-icon">📁</div>
      <p className="dropzone-text dropzone-text-desktop">
        {t('upload.dropzone')}
      </p>
      <p className="dropzone-text dropzone-text-mobile">
        {t('upload.tapToSelect')}
      </p>
      <p className="dropzone-formats dropzone-formats-desktop">
        {t('upload.formatsWithPaste')}
      </p>
      <p className="dropzone-formats dropzone-formats-mobile">
        {t('upload.formats')}
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/tiff,image/heic,image/heif,.tif,.tiff,.heic,.heif,application/pdf"
        onChange={(e) => handleFiles(e.target.files)}
        style={{ display: 'none' }}
      />
    </div>
  )
}
