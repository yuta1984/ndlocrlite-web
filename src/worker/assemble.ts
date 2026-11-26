/**
 * 認識結果（行単位）を読み順に並べ、ページの結果を組み立てる
 * メインスレッド・ocr.worker・テストで共通利用
 */

import type { TextBlock, TextRegion, PageBlock } from '../types/ocr'
import { ReadingOrderProcessor } from './reading-order'

const readingOrder = new ReadingOrderProcessor()

export interface AssembledPage {
  textBlocks: TextBlock[]
  fullText: string
}

export function assemblePage(regions: TextRegion[], texts: string[], pageBlocks: PageBlock[]): AssembledPage {
  const blocks: TextBlock[] = regions.map((region, i) => ({
    ...region,
    text: texts[i] ?? '',
    readingOrder: i + 1,
  }))
  const ordered = readingOrder.process(blocks, pageBlocks)
  const fullText = ordered.filter((b) => b.text).map((b) => b.text).join('\n')
  return { textBlocks: ordered, fullText }
}
