import { useCallback, useEffect, useRef, useState } from 'react'
import { clampResultPanelWidth as clampWidth, DEFAULT_RESULT_PANEL_WIDTH as DEFAULT_WIDTH } from '../../hooks/useResultPanelWidth'

interface ResizeHandleProps {
  width: number
  onChange: (width: number) => void
  lang: 'ja' | 'en'
}

/**
 * 画像ビューアと結果パネルの間のドラッグハンドル
 * 左右にドラッグすると結果パネルの幅が変わる（ダブルクリックで既定幅に戻す、矢印キーでも調整可）
 */
export function ResizeHandle({ width, onChange, lang }: ResizeHandleProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; startWidth: number; container: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const containerWidth = () => ref.current?.parentElement?.getBoundingClientRect().width ?? window.innerWidth

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startWidth: width, container: containerWidth() }
    setDragging(true)
  }, [width])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    // ハンドルを左へ動かすと右パネルが広がる
    onChange(clampWidth(d.startWidth + (d.startX - e.clientX), d.container))
  }, [onChange])

  const endDrag = useCallback(() => {
    drag.current = null
    setDragging(false)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 50 : 10
    if (e.key === 'ArrowLeft') onChange(clampWidth(width + step, containerWidth()))
    else if (e.key === 'ArrowRight') onChange(clampWidth(width - step, containerWidth()))
    else return
    e.preventDefault()
  }

  // ドラッグ中は文字選択・カーソルを全体で固定
  useEffect(() => {
    if (!dragging) return
    document.body.classList.add('is-resizing')
    return () => document.body.classList.remove('is-resizing')
  }, [dragging])

  return (
    <div
      ref={ref}
      className={`result-splitter ${dragging ? 'dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-label={lang === 'ja' ? '結果パネルの幅を調整' : 'Resize result panel'}
      title={lang === 'ja' ? 'ドラッグで幅を調整（ダブルクリックで元に戻す）' : 'Drag to resize (double-click to reset)'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(clampWidth(DEFAULT_WIDTH, containerWidth()))}
      onKeyDown={onKeyDown}
    />
  )
}
