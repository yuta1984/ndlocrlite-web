/**
 * ユーザー設定（localStorage に保存）
 */
import { useSyncExternalStore } from 'react'

export interface AppSettings {
  /** レイアウト検出の実行バックエンド（'auto': WebGPU が使えれば WebGPU） */
  backend: 'auto' | 'wasm'
  /** 認識 Worker 数（0 = 自動） */
  recWorkers: number
  /** 異体字を新字体に変換（包摂）して出力する */
  characterInclusion: boolean
  /** 表構造を推定する（TableCenterNet） */
  tableStructure: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  backend: 'auto',
  recWorkers: 0,
  characterInclusion: false,
  tableStructure: false,
}

const KEY = 'ndlocr-lite-web.settings'
const listeners = new Set<() => void>()
let cache: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    cache = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) }
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache!
}

export function updateSettings(patch: Partial<AppSettings>) {
  cache = { ...getSettings(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // ストレージ不可（プライベートモード等）は無視
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const settings = useSyncExternalStore(subscribe, getSettings, getSettings)
  return [settings, updateSettings]
}
