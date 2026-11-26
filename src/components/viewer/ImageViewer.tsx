import { useEffect, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import type { TextBlock, BoundingBox, PageBlock } from '../../types/ocr'
import { useSettings } from '../../utils/settings'
import { normalizeRect, isValidRegion, blocksInRect, hitTest, type Point } from './viewer-geometry'

interface ImageViewerProps {
  imageDataUrl: string
  textBlocks: TextBlock[]
  selectedBlock: TextBlock | null
  onBlockSelect: (block: TextBlock) => void
  onRegionSelect: (blocks: TextBlock[], bbox: BoundingBox) => void
  pageBlocks?: PageBlock[]
  selectedPageBlock?: PageBlock | null
  onPageBlockSelect?: (block: PageBlock) => void
  lang?: 'ja' | 'en'
}

type Mode = 'pan' | 'select'

/**
 * 資料画像ビューア（OpenSeadragon）
 * - ズーム・移動モード: ドラッグで移動、ホイール/ピンチでズーム、クリックで行を選択
 * - 領域選択モード: ドラッグした範囲だけを認識（ホイールでのズームは可能）
 * 行・ブロックの枠は OpenSeadragon のオーバーレイとして画像座標で配置する
 */
export function ImageViewer({
  imageDataUrl, textBlocks, selectedBlock, onBlockSelect, onRegionSelect,
  pageBlocks, selectedPageBlock, onPageBlockSelect, lang = 'ja',
}: ImageViewerProps) {
  const ja = lang === 'ja'
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const selectionElRef = useRef<HTMLDivElement | null>(null)
  const boxElsRef = useRef<HTMLElement[]>([])
  const [settings, updateSettings] = useSettings()
  const mode: Mode = settings.viewerMode
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)

  // イベントハンドラから最新の props / mode を参照するための ref
  const latest = useRef({ mode, textBlocks, pageBlocks, onBlockSelect, onPageBlockSelect, onRegionSelect })
  useEffect(() => {
    latest.current = { mode, textBlocks, pageBlocks, onBlockSelect, onPageBlockSelect, onRegionSelect }
  })

  // ビューアの生成（1 回だけ）
  useEffect(() => {
    if (!containerRef.current) return
    const viewer = OpenSeadragon({
      element: containerRef.current,
      showNavigationControl: false,
      visibilityRatio: 0.3,
      minZoomImageRatio: 0.5,
      maxZoomPixelRatio: 8,
      animationTime: 0.5,
      gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true },
      gestureSettingsTouch: { clickToZoom: false, dblClickToZoom: true, pinchToZoom: true },
    })
    viewerRef.current = viewer

    const toImage = (pos: OpenSeadragon.Point): Point => {
      const p = viewer.viewport.viewerElementToImageCoordinates(pos)
      return { x: p.x, y: p.y }
    }
    const currentSize = () => {
      const item = viewer.world.getItemAt(0)
      return item ? item.getContentSize() : null
    }

    let dragStart: Point | null = null
    const removeSelection = () => {
      if (selectionElRef.current) {
        viewer.removeOverlay(selectionElRef.current)
        selectionElRef.current = null
      }
    }

    viewer.addHandler('canvas-click', (e) => {
      if (!e.quick) return
      e.preventDefaultAction = true
      const hit = hitTest(toImage(e.position), latest.current.textBlocks, latest.current.pageBlocks ?? [])
      if (hit?.kind === 'line') latest.current.onBlockSelect(hit.block)
      else if (hit?.kind === 'page') latest.current.onPageBlockSelect?.(hit.block)
    })

    viewer.addHandler('canvas-press', (e) => {
      if (latest.current.mode !== 'select') return
      dragStart = toImage(e.position)
    })

    viewer.addHandler('canvas-drag', (e) => {
      if (latest.current.mode !== 'select' || !dragStart) return
      e.preventDefaultAction = true // 領域選択モードではドラッグで移動しない
      const size = currentSize()
      if (!size) return
      const rect = normalizeRect(dragStart, toImage(e.position), size.x, size.y)
      const vpRect = viewer.viewport.imageToViewportRectangle(rect.x, rect.y, rect.width, rect.height)
      if (!selectionElRef.current) {
        const el = document.createElement('div')
        el.className = 'drag-selection'
        selectionElRef.current = el
        viewer.addOverlay(el, vpRect)
      } else {
        viewer.updateOverlay(selectionElRef.current, vpRect)
      }
    })

    viewer.addHandler('canvas-release', (e) => {
      if (latest.current.mode !== 'select' || !dragStart) return
      const size = currentSize()
      const start = dragStart
      dragStart = null
      removeSelection()
      if (!size) return
      const rect = normalizeRect(start, toImage(e.position), size.x, size.y)
      if (isValidRegion(rect)) {
        latest.current.onRegionSelect(blocksInRect(rect, latest.current.textBlocks), rect)
      }
    })

    viewer.addHandler('open', () => {
      const size = currentSize()
      setImageSize(size ? { width: size.x, height: size.y } : null)
    })

    return () => {
      viewer.destroy()
      viewerRef.current = null
      selectionElRef.current = null
      boxElsRef.current = []
    }
  }, [])

  // 画像の切り替え
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    setImageSize(null)
    boxElsRef.current = []
    if (imageDataUrl) viewer.open({ type: 'image', url: imageDataUrl } as unknown as Parameters<OpenSeadragon.Viewer['open']>[0])
    else viewer.close()
  }, [imageDataUrl])

  // 行・ブロックの枠（オーバーレイ）
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !imageSize) return
    boxElsRef.current.forEach((el) => viewer.removeOverlay(el))
    boxElsRef.current = []

    const add = (b: BoundingBox, className: string, title?: string) => {
      const el = document.createElement('div')
      el.className = className
      if (title) el.title = title
      viewer.addOverlay(el, viewer.viewport.imageToViewportRectangle(b.x, b.y, b.width, b.height))
      boxElsRef.current.push(el)
    }
    pageBlocks?.forEach((b) => add(b, `page-block-box ${selectedPageBlock === b ? 'selected' : ''}`))
    textBlocks.forEach((b) => add(b, `region-box ${selectedBlock === b ? 'selected' : ''}`, b.text))
  }, [imageSize, textBlocks, pageBlocks, selectedBlock, selectedPageBlock])

  // 選択した行が画面外ならその位置へ移動
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !selectedBlock || !imageSize) return
    const r = viewer.viewport.imageToViewportRectangle(selectedBlock.x, selectedBlock.y, selectedBlock.width, selectedBlock.height)
    const bounds = viewer.viewport.getBounds()
    const visible = r.x >= bounds.x && r.y >= bounds.y && r.x + r.width <= bounds.x + bounds.width && r.y + r.height <= bounds.y + bounds.height
    if (!visible) viewer.viewport.panTo(r.getCenter())
  }, [selectedBlock, imageSize])

  const setMode = (m: Mode) => updateSettings({ viewerMode: m })
  const zoom = (factor: number) => {
    const v = viewerRef.current
    if (!v) return
    v.viewport.zoomBy(factor)
    v.viewport.applyConstraints()
  }

  // キーボード: V = ズーム・移動、R = 領域選択、+/- = ズーム、0 = 全体表示（入力欄では無効）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('.panel-overlay, .region-ocr-backdrop')) return
      const k = e.key.toLowerCase()
      if (k === 'v') updateSettings({ viewerMode: 'pan' })
      else if (k === 'r') updateSettings({ viewerMode: 'select' })
      else if (k === '+' || k === '=') zoom(1.4)
      else if (k === '-') zoom(1 / 1.4)
      else if (k === '0') viewerRef.current?.viewport.goHome()
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [updateSettings])

  return (
    <div className={`image-viewer osd-viewer mode-${mode}`} data-testid="image-viewer">
      <div ref={containerRef} className="osd-container" />
      <div className="viewer-toolbar" role="toolbar" aria-label={ja ? 'ビューア操作' : 'Viewer controls'}>
        <div className="viewer-mode-toggle" role="radiogroup" aria-label={ja ? '操作モード' : 'Mode'}>
          <button
            role="radio"
            aria-checked={mode === 'pan'}
            className={mode === 'pan' ? 'active' : ''}
            onClick={() => setMode('pan')}
            title={ja ? 'ズーム・移動（V）' : 'Zoom & pan (V)'}
          >
            ✋ <span className="viewer-btn-label">{ja ? '移動' : 'Pan'}</span>
          </button>
          <button
            role="radio"
            aria-checked={mode === 'select'}
            className={mode === 'select' ? 'active' : ''}
            onClick={() => setMode('select')}
            title={ja ? '領域選択（R）: ドラッグした範囲だけを認識' : 'Select region (R): recognize only the dragged area'}
          >
            ⬚ <span className="viewer-btn-label">{ja ? '領域選択' : 'Select'}</span>
          </button>
        </div>
        <div className="viewer-zoom">
          <button onClick={() => zoom(1.4)} title={ja ? '拡大（+）' : 'Zoom in (+)'} aria-label={ja ? '拡大' : 'Zoom in'}>＋</button>
          <button onClick={() => zoom(1 / 1.4)} title={ja ? '縮小（-）' : 'Zoom out (-)'} aria-label={ja ? '縮小' : 'Zoom out'}>−</button>
          <button onClick={() => viewerRef.current?.viewport.goHome()} title={ja ? '全体表示（0）' : 'Fit (0)'} aria-label={ja ? '全体表示' : 'Fit'}>⤢</button>
        </div>
      </div>
    </div>
  )
}
