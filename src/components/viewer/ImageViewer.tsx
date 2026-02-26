import { useRef, useEffect, useState } from 'react'
import type { TextBlock, BoundingBox } from '../../types/ocr'

interface ImageViewerProps {
  imageDataUrl: string
  textBlocks: TextBlock[]
  selectedBlock: TextBlock | null
  onBlockSelect: (block: TextBlock) => void
  onRegionSelect?: (blocks: TextBlock[], bbox: BoundingBox) => void
}

export function ImageViewer({
  imageDataUrl,
  textBlocks,
  selectedBlock,
  onBlockSelect,
  onRegionSelect,
}: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 })
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const updateSize = () => {
      if (imgRef.current) {
        setImgSize({ width: imgRef.current.clientWidth, height: imgRef.current.clientHeight })
        setNaturalSize({ width: imgRef.current.naturalWidth, height: imgRef.current.naturalHeight })
      }
    }
    const img = imgRef.current
    if (img) {
      img.addEventListener('load', updateSize)
      updateSize()
    }
    window.addEventListener('resize', updateSize)
    return () => {
      img?.removeEventListener('load', updateSize)
      window.removeEventListener('resize', updateSize)
    }
  }, [imageDataUrl])

  const scaleX = naturalSize.width > 0 ? imgSize.width / naturalSize.width : 1
  const scaleY = naturalSize.height > 0 ? imgSize.height / naturalSize.height : 1

  const getRelativePos = (e: React.MouseEvent) => {
    const rect = imgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!onRegionSelect) return
    const pos = getRelativePos(e)
    setDragStart(pos)
    setDragCurrent(pos)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart) return
    setDragCurrent(getRelativePos(e))
  }

  const handleMouseUp = () => {
    if (!dragStart || !dragCurrent || !onRegionSelect) {
      setDragStart(null)
      setDragCurrent(null)
      return
    }
    // スクリーン座標 → 元画像座標に変換
    const x1 = Math.min(dragStart.x, dragCurrent.x) / scaleX
    const y1 = Math.min(dragStart.y, dragCurrent.y) / scaleY
    const x2 = Math.max(dragStart.x, dragCurrent.x) / scaleX
    const y2 = Math.max(dragStart.y, dragCurrent.y) / scaleY

    const bbox: BoundingBox = {
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1,
    }

    // 選択範囲と重なるブロックを抽出
    const selected = textBlocks.filter((b) => {
      return b.x < x2 && b.x + b.width > x1 && b.y < y2 && b.y + b.height > y1
    })

    const MIN_DRAG = 15 // 元画像座標での最小ドラッグサイズ(px)
    if (bbox.width >= MIN_DRAG && bbox.height >= MIN_DRAG) {
      onRegionSelect(selected, bbox)
    }

    setDragStart(null)
    setDragCurrent(null)
  }

  const selectionRect =
    dragStart && dragCurrent
      ? {
          left: Math.min(dragStart.x, dragCurrent.x),
          top: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null

  return (
    <div
      className="image-viewer"
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <img
        ref={imgRef}
        src={imageDataUrl}
        alt="OCR対象画像"
        className="viewer-image"
        draggable={false}
      />

      {/* テキスト領域オーバーレイ */}
      <div className="viewer-overlay" style={{ width: imgSize.width, height: imgSize.height }}>
        {textBlocks.map((block, i) => (
          <div
            key={i}
            className={`region-box ${selectedBlock === block ? 'selected' : ''}`}
            style={{
              left: block.x * scaleX,
              top: block.y * scaleY,
              width: block.width * scaleX,
              height: block.height * scaleY,
            }}
            onClick={() => onBlockSelect(block)}
            title={block.text}
          />
        ))}

        {/* マウスドラッグ選択範囲 */}
        {selectionRect && (
          <div
            className="drag-selection"
            style={{
              left: selectionRect.left,
              top: selectionRect.top,
              width: selectionRect.width,
              height: selectionRect.height,
            }}
          />
        )}
      </div>
    </div>
  )
}
