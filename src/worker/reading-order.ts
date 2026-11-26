/**
 * 読み順処理モジュール（XY-Cut アルゴリズム）
 * 参照実装: ndlocr-lite/src/reading_order/xy_cut/block_xy_cut.py
 *
 * 旧実装（閾値ベース貪欲グループ化）の問題点:
 *   - 閾値 = 中央値の30% ≈ 行幅の30%（縦書きで約9px）
 *   - 同一段内の行間距離（30〜40px）がこの閾値を超えるため、同じ段の行が別グループに分裂
 *   - ページ全体の空白構造（段間ギャップ）を認識できない
 *
 * XY-Cut が解決する点:
 *   - ページを2Dグリッドに投影し、x/yヒストグラムの最大ゼロ区間（= 段間ギャップ）を検出
 *   - 再帰的に分割することで複合レイアウトを正しく処理
 *   - 縦書き x分割ノードで children を逆順にすることで右→左の段順を実現
 */

import type { TextBlock, PageBlock } from '../types/ocr'

interface XYNode {
  x0: number
  y0: number
  x1: number
  y1: number
  children: XYNode[]
  lineIndices: number[]
  numLines: number
  numVerticalLines: number
  isXSplit: boolean  // true = 左右分割、false = 上下分割
}

function makeNode(x0: number, y0: number, x1: number, y1: number): XYNode {
  return { x0, y0, x1, y1, children: [], lineIndices: [], numLines: 0, numVerticalLines: 0, isXSplit: false }
}

export class ReadingOrderProcessor {
  // 正規化グリッドサイズ（参照実装の get_optimal_grid に対応）
  private readonly GRID = 100

  /**
   * 公開 API
   * blocks が渡された場合はブロック割り当て優先、なければ XY-Cut にフォールバック
   */
  process(textBlocks: TextBlock[], blocks?: PageBlock[], options: { minConfidence?: number } = {}): TextBlock[] {
    if (!textBlocks || textBlocks.length === 0) return []
    const { minConfidence = 0.1 } = options

    const validBlocks = textBlocks.filter(
      b => b.confidence >= minConfidence && b.text && b.text.trim().length > 0
    )
    if (validBlocks.length === 0) return []
    if (validBlocks.length === 1) {
      return [{ ...validBlocks[0], readingOrder: 1 }]
    }

    if (blocks && blocks.length > 0) {
      return this.processWithBlocks(validBlocks, blocks)
    }
    return this.processXYCut(validBlocks)
  }

  /**
   * DEIMモデルの text_block 出力を使って段割り→行ソートを行う
   *
   * 設計方針:
   *   - 未割り当て行（text_block に収まらない行）を末尾追加せず「1行グループ」として扱い、
   *     グループ bbox 全体に XY-Cut を実行して正しい位置に配置する
   *   - text_block が段単位で正確なら XY-Cut の入力が整理されて精度向上
   *   - text_block が不正確でも XY-Cut on all lines と同等に劣化するだけで悪化しない
   */
  private processWithBlocks(lines: TextBlock[], blocks: PageBlock[]): TextBlock[] {
    // 1. 各行の中心点がどのブロック内に収まるか判定
    const assigned = new Map<number, TextBlock[]>()
    const unassigned: TextBlock[] = []
    for (const line of lines) {
      const cx = line.x + line.width / 2
      const cy = line.y + line.height / 2
      const blockIdx = blocks.findIndex(
        b => cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height
      )
      if (blockIdx >= 0) {
        if (!assigned.has(blockIdx)) assigned.set(blockIdx, [])
        assigned.get(blockIdx)!.push(line)
      } else {
        unassigned.push(line)
      }
    }

    // 2. カバー率が低い場合（< 70%）は XY-Cut にフォールバック
    const allAssigned = [...assigned.values()].flat()
    if (allAssigned.length < lines.length * 0.7) {
      return this.processXYCut(lines)
    }

    // 3. グループを生成
    //    - text_block 割り当て済みグループ: bbox = グループ内全行の外接矩形
    //    - 未割り当て行: 各行を独立した 1 行グループとして扱う（末尾追加しない）
    type Group = { lines: TextBlock[]; bbox: number[] }
    const groups: Group[] = []

    for (const groupLines of assigned.values()) {
      const x0 = Math.min(...groupLines.map(l => l.x))
      const y0 = Math.min(...groupLines.map(l => l.y))
      const x1 = Math.max(...groupLines.map(l => l.x + l.width))
      const y1 = Math.max(...groupLines.map(l => l.y + l.height))
      groups.push({ lines: groupLines, bbox: [x0, y0, x1, y1] })
    }
    for (const line of unassigned) {
      groups.push({ lines: [line], bbox: [line.x, line.y, line.x + line.width, line.y + line.height] })
    }

    // 4. グループ bbox に XY-Cut を実行してグループ間の読み順を決定
    const groupRanks = this.getXYCutRanks(groups.map(g => g.bbox))

    // 5. グループを読み順にソート
    const sortedGroups = groups
      .map((g, i) => ({ ...g, rank: groupRanks[i] }))
      .sort((a, b) => a.rank - b.rank)

    // 6. 各グループ内の行を XY-Cut で整序
    const result: TextBlock[] = []
    for (const group of sortedGroups) {
      result.push(...(group.lines.length > 1 ? this.processXYCut(group.lines) : group.lines))
    }

    return result.map((b, i) => ({ ...b, readingOrder: i + 1 }))
  }

  /** XY-Cut アルゴリズムによる読み順推定（フォールバック） */
  private processXYCut(validBlocks: TextBlock[]): TextBlock[] {
    const rawBboxes = validBlocks.map(b => [b.x, b.y, b.x + b.width, b.y + b.height])
    const ranks = this.getXYCutRanks(rawBboxes)
    const result = validBlocks.map((block, i) => ({ ...block, readingOrder: ranks[i] + 1 }))
    result.sort((a, b) => a.readingOrder - b.readingOrder)
    return result
  }

  /** XY-Cut を rawBboxes に対して実行しランク配列を返すヘルパー */
  private getXYCutRanks(rawBboxes: number[][]): number[] {
    if (rawBboxes.length === 0) return []
    if (rawBboxes.length === 1) return [0]
    const { normBboxes, w, h } = this.normalizeBboxes(rawBboxes)
    const table = this.makeMeshTable(normBboxes, w, h)
    const root = makeNode(0, 0, w, h)
    this.xyCut(table, root)
    this.assignBboxToNode(root, normBboxes)
    this.sortNodes(root, normBboxes)
    const ranks = new Array(rawBboxes.length).fill(-1)
    this.getRanking(root, ranks, 0)
    return ranks
  }

  // ---------------------------------------------------------------------------
  // 参照実装 normalize_bboxes に対応
  // bboxes を [0, GRID] の整数グリッドにスケーリング
  // ---------------------------------------------------------------------------
  private normalizeBboxes(bboxes: number[][]): { normBboxes: number[][], w: number, h: number } {
    const xMin = Math.min(...bboxes.map(b => b[0]))
    const yMin = Math.min(...bboxes.map(b => b[1]))
    const xMax = Math.max(...bboxes.map(b => b[2]))
    const yMax = Math.max(...bboxes.map(b => b[3]))
    const wPage = xMax - xMin
    const hPage = yMax - yMin
    if (wPage === 0 || hPage === 0) {
      // 全ブロックが同一座標: 正規化不能 → そのまま返す
      const norm = bboxes.map(() => [0, 0, 1, 1])
      return { normBboxes: norm, w: 2, h: 2 }
    }

    // 短辺に GRID を割り当て、長辺はアスペクト比を維持
    const isPortrait = hPage >= wPage
    const xGrid = isPortrait ? this.GRID * (wPage / hPage) : this.GRID
    const yGrid = isPortrait ? this.GRID : this.GRID * (hPage / wPage)
    const w = Math.ceil(xGrid) + 1
    const h = Math.ceil(yGrid) + 1

    const normBboxes = bboxes.map(b => {
      const nx0 = Math.max(0, Math.floor((b[0] - xMin) * xGrid / wPage))
      const ny0 = Math.max(0, Math.floor((b[1] - yMin) * yGrid / hPage))
      const nx1 = Math.min(w - 1, Math.ceil((b[2] - xMin) * xGrid / wPage))
      const ny1 = Math.min(h - 1, Math.ceil((b[3] - yMin) * yGrid / hPage))
      return [nx0, ny0, Math.max(nx0 + 1, nx1), Math.max(ny0 + 1, ny1)]
    })
    return { normBboxes, w, h }
  }

  // ---------------------------------------------------------------------------
  // 参照実装 make_mesh_table に対応
  // 正規化済み bboxes を w×h の 0/1 二値テーブルに描画
  // ---------------------------------------------------------------------------
  private makeMeshTable(bboxes: number[][], w: number, h: number): number[][] {
    const table: number[][] = Array.from({ length: h }, () => new Array(w).fill(0))
    for (const [x0, y0, x1, y1] of bboxes) {
      for (let y = y0; y < Math.min(y1, h); y++) {
        for (let x = x0; x < Math.min(x1, w); x++) {
          table[y][x] = 1
        }
      }
    }
    return table
  }

  // ---------------------------------------------------------------------------
  // 参照実装 calc_hist に対応
  // 領域 [x0,y0,x1,y1] 内の x方向（列和）・y方向（行和）ヒストグラムを計算
  // ---------------------------------------------------------------------------
  private calcHist(
    table: number[][], x0: number, y0: number, x1: number, y1: number
  ): { xHist: number[], yHist: number[] } {
    const xHist = new Array(x1 - x0).fill(0)
    const yHist = new Array(y1 - y0).fill(0)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const v = table[y][x]
        xHist[x - x0] += v
        yHist[y - y0] += v
      }
    }
    return { xHist, yHist }
  }

  // ---------------------------------------------------------------------------
  // 参照実装 calc_min_span に対応
  // ヒストグラムの最小値が連続する最長区間を返す（= 最大ギャップ）
  // 戻り値: [gapStart, gapEnd, score]  score = -minVal/maxVal（小さいほど明確なギャップ）
  // ---------------------------------------------------------------------------
  private calcMinSpan(hist: number[]): [number, number, number] {
    if (hist.length <= 1) return [0, hist.length, 0]
    const minVal = Math.min(...hist)
    const maxVal = Math.max(...hist)
    let bestStart = 0, bestEnd = 0, bestLen = 0
    let gapStart = -1
    for (let i = 0; i <= hist.length; i++) {
      if (i < hist.length && hist[i] === minVal) {
        if (gapStart === -1) gapStart = i
      } else {
        if (gapStart !== -1) {
          const len = i - gapStart
          if (len > bestLen) { bestLen = len; bestStart = gapStart; bestEnd = i }
          gapStart = -1
        }
      }
    }
    const score = maxVal > 0 ? -minVal / maxVal : 0
    return [bestStart, bestEnd, score]
  }

  // ---------------------------------------------------------------------------
  // 参照実装 block_xy_cut に対応（再帰）
  // ---------------------------------------------------------------------------
  private xyCut(table: number[][], node: XYNode): void {
    const { x0, y0, x1, y1 } = node
    if (x0 >= x1 || y0 >= y1) return

    const { xHist, yHist } = this.calcHist(table, x0, y0, x1, y1)
    const [xBeg0, xEnd0, xVal] = this.calcMinSpan(xHist)
    const [yBeg0, yEnd0, yVal] = this.calcMinSpan(yHist)
    const xBeg = xBeg0 + x0, xEnd = xEnd0 + x0
    const yBeg = yBeg0 + y0, yEnd = yEnd0 + y0

    // 全域と一致する場合（分割不能）→ 再帰終了
    if (x0 === xBeg && x1 === xEnd && y0 === yBeg && y1 === yEnd) return

    // x/y どちらの方向で分割するかを決定（参照実装の条件式と同一）
    if (yVal < xVal) {
      this.splitX(table, node, xBeg, xEnd)
    } else if (xVal < yVal) {
      this.splitY(table, node, yBeg, yEnd)
    } else if ((xEnd - xBeg) < (yEnd - yBeg)) {
      this.splitY(table, node, yBeg, yEnd)
    } else {
      this.splitX(table, node, xBeg, xEnd)
    }
  }

  // 参照実装 split_x → 左・ギャップ・右 の3ノードを追加し再帰
  private splitX(table: number[][], parent: XYNode, gapX0: number, gapX1: number): void {
    parent.isXSplit = true
    const { x0, y0, x1, y1 } = parent
    this.addChildAndCut(table, parent, x0, y0, gapX0, y1)
    this.addChildAndCut(table, parent, gapX0, y0, gapX1, y1)
    this.addChildAndCut(table, parent, gapX1, y0, x1, y1)
  }

  // 参照実装 split_y → 上・ギャップ・下 の3ノードを追加し再帰
  private splitY(table: number[][], parent: XYNode, gapY0: number, gapY1: number): void {
    parent.isXSplit = false
    const { x0, y0, x1, y1 } = parent
    this.addChildAndCut(table, parent, x0, y0, x1, gapY0)
    this.addChildAndCut(table, parent, x0, gapY0, x1, gapY1)
    this.addChildAndCut(table, parent, x0, gapY1, x1, y1)
  }

  private addChildAndCut(
    table: number[][], parent: XYNode,
    x0: number, y0: number, x1: number, y1: number
  ): void {
    if (x0 >= x1 || y0 >= y1) return
    // 親ノードと同一領域なら追加しない（無限ループ防止）
    if (x0 === parent.x0 && y0 === parent.y0 && x1 === parent.x1 && y1 === parent.y1) return
    const child = makeNode(x0, y0, x1, y1)
    parent.children.push(child)
    this.xyCut(table, child)
  }

  // ---------------------------------------------------------------------------
  // 参照実装 assign_bbox_to_node に対応
  // 各 bbox を最大 IoU の葉ノードに割り当て
  // ---------------------------------------------------------------------------
  private assignBboxToNode(root: XYNode, bboxes: number[][]): void {
    const leaves = this.collectLeaves(root)
    const leafBboxes = leaves.map(l => [l.x0, l.y0, l.x1, l.y1])

    for (let i = 0; i < bboxes.length; i++) {
      const ious = this.calcIous(bboxes[i], leafBboxes)
      let bestJ = 0, bestIou = -1
      for (let j = 0; j < ious.length; j++) {
        if (ious[j] > bestIou) { bestIou = ious[j]; bestJ = j }
      }
      leaves[bestJ].lineIndices.push(i)
    }
  }

  private collectLeaves(node: XYNode): XYNode[] {
    if (node.children.length === 0) return [node]
    return node.children.flatMap(c => this.collectLeaves(c))
  }

  // IoU: 1対多
  private calcIous(box: number[], boxes: number[][]): number[] {
    return boxes.map(b => {
      const ix0 = Math.max(box[0], b[0])
      const iy0 = Math.max(box[1], b[1])
      const ix1 = Math.min(box[2], b[2])
      const iy1 = Math.min(box[3], b[3])
      const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0)
      if (inter === 0) return 0
      const areaA = (box[2] - box[0]) * (box[3] - box[1])
      const areaB = (b[2] - b[0]) * (b[3] - b[1])
      return inter / (areaA + areaB - inter)
    })
  }

  // ---------------------------------------------------------------------------
  // 参照実装 sort_nodes に対応
  // 各ノード内の lineIndices と children をソートし、縦書き x分割ノードを逆順に
  // ---------------------------------------------------------------------------
  private sortNodes(node: XYNode, bboxes: number[][]): [number, number] {
    if (node.lineIndices.length > 0) {
      // 葉ノード: このノードに直接割り当てられた行をソート
      const indices = node.lineIndices
      node.numLines = indices.length
      node.numVerticalLines = indices.filter(i => {
        const b = bboxes[i]
        return (b[2] - b[0]) < (b[3] - b[1])  // width < height
      }).length

      if (indices.length > 1) {
        const isVert = this.isVertical(node)
        indices.sort((a, b) => {
          const ba = bboxes[a], bb = bboxes[b]
          const ax0 = ba[0], ay0 = ba[1]
          const bx0 = bb[0], by0 = bb[1]
          // 縦書き: x降順 y昇順、横書き: y昇順 x昇順（参照実装 lexsort と同等）
          if (isVert) return ax0 !== bx0 ? bx0 - ax0 : ay0 - by0
          return ay0 !== by0 ? ay0 - by0 : ax0 - bx0
        })
      }
    } else {
      // 内部ノード: 子ノードを再帰的にソートして統計を集計
      for (const child of node.children) {
        const [n, v] = this.sortNodes(child, bboxes)
        node.numLines += n
        node.numVerticalLines += v
      }
      // 縦書きの x分割ノード → children を逆順（右→左）
      if (node.isXSplit && this.isVertical(node)) {
        node.children.reverse()
      }
    }
    return [node.numLines, node.numVerticalLines]
  }

  // 縦書き判定: 縦長ブロックが過半数
  private isVertical(node: XYNode): boolean {
    return node.numLines < node.numVerticalLines * 2
  }

  // ---------------------------------------------------------------------------
  // 参照実装 get_ranking に対応（深さ優先で rank を付番）
  // ---------------------------------------------------------------------------
  private getRanking(node: XYNode, ranks: number[], rank: number): number {
    for (const i of node.lineIndices) {
      ranks[i] = rank++
    }
    for (const child of node.children) {
      rank = this.getRanking(child, ranks, rank)
    }
    return rank
  }
}
