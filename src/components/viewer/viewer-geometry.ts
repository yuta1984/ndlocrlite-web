/**
 * ビューア用の幾何計算（OpenSeadragon 非依存・単体テスト対象）
 * 座標はすべて元画像のピクセル座標
 */
import type { BoundingBox, PageBlock, TextBlock } from '../../types/ocr'

export interface Point { x: number; y: number }

/** 領域選択で有効とみなす最小サイズ（元画像ピクセル） */
export const MIN_REGION_SIZE = 15

/** 2 点から矩形を作り、画像範囲にクリップする */
export function normalizeRect(a: Point, b: Point, imageWidth: number, imageHeight: number): BoundingBox {
  const x1 = Math.max(0, Math.min(a.x, b.x))
  const y1 = Math.max(0, Math.min(a.y, b.y))
  const x2 = Math.min(imageWidth, Math.max(a.x, b.x))
  const y2 = Math.min(imageHeight, Math.max(a.y, b.y))
  return {
    x: Math.round(x1),
    y: Math.round(y1),
    width: Math.max(0, Math.round(x2 - x1)),
    height: Math.max(0, Math.round(y2 - y1)),
  }
}

export function isValidRegion(rect: BoundingBox): boolean {
  return rect.width >= MIN_REGION_SIZE && rect.height >= MIN_REGION_SIZE
}

const contains = (b: BoundingBox, p: Point) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height

/** 矩形と重なる行 */
export function blocksInRect<T extends BoundingBox>(rect: BoundingBox, blocks: T[]): T[] {
  return blocks.filter(
    (b) => b.x < rect.x + rect.width && b.x + b.width > rect.x && b.y < rect.y + rect.height && b.y + b.height > rect.y
  )
}

export type HitResult =
  | { kind: 'line'; block: TextBlock }
  | { kind: 'page'; block: PageBlock }
  | null

/**
 * クリック位置の要素を返す。行を優先し、重なる場合は面積の小さいもの（より内側）を選ぶ
 */
export function hitTest(p: Point, lines: TextBlock[], pageBlocks: PageBlock[] = []): HitResult {
  const area = (b: BoundingBox) => b.width * b.height
  const line = lines.filter((b) => contains(b, p)).sort((a, b) => area(a) - area(b))[0]
  if (line) return { kind: 'line', block: line }
  const page = pageBlocks.filter((b) => contains(b, p)).sort((a, b) => area(a) - area(b))[0]
  if (page) return { kind: 'page', block: page }
  return null
}
