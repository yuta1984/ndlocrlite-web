import { useEffect, useState } from 'react'

const STORAGE_KEY = 'ndlocr-lite-web.resultPanelWidth'
export const DEFAULT_RESULT_PANEL_WIDTH = 400
const MIN_WIDTH = 280
/** 画像側に最低限残す幅 */
const MIN_LEFT = 320

export function clampResultPanelWidth(w: number, containerWidth: number) {
  const max = Math.max(MIN_WIDTH, containerWidth - MIN_LEFT)
  return Math.round(Math.min(Math.max(w, MIN_WIDTH), max))
}

/** 結果パネル（右カラム）の幅。localStorage に保存して次回も復元する */
export function useResultPanelWidth() {
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : DEFAULT_RESULT_PANEL_WIDTH
  })
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(width)) } catch { /* ignore */ }
  }, [width])
  return [width, setWidth] as const
}

