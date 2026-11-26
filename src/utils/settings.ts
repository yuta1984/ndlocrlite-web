/**
 * ユーザー設定（localStorage に保存）
 */
import { useSyncExternalStore } from 'react'
import type { ExportFormat } from './textExport'

export interface AppSettings {
  /** レイアウト検出の実行バックエンド（'auto': WebGPU が使えれば WebGPU） */
  backend: 'auto' | 'wasm'
  /** 認識 Worker 数（0 = 自動） */
  recWorkers: number
  /** 異体字を新字体に変換（包摂）して出力する */
  characterInclusion: boolean
  /** 表構造を推定する（TableCenterNet） */
  tableStructure: boolean
  /** エクスポート形式・オプション（テキストエリアとサイドバーで共有） */
  exportFormat: ExportFormat
  includeFileName: boolean
  ignoreNewlines: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  backend: 'auto',
  recWorkers: 0,
  characterInclusion: false,
  tableStructure: true,
  exportFormat: 'txt',
  includeFileName: false,
  ignoreNewlines: false,
}

const KEY = 'ndlocr-lite-web.settings'
/** 保存形式のバージョン。既定値を変えたときに既存の保存値を一度だけ移行する */
const SETTINGS_VERSION = 2
const listeners = new Set<() => void>()
let cache: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    const saved = raw ? JSON.parse(raw) : {}
    cache = migrate({ ...DEFAULT_SETTINGS, ...saved }, saved.version ?? 1)
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache!
}

/** v1 → v2: 表構造推定を既定で有効化（v1 では既定 off のまま保存されていたため一度だけ on にする） */
export function migrate(settings: AppSettings, version: number): AppSettings {
  let s = settings
  if (version < 2) s = { ...s, tableStructure: true }
  return s
}

export function updateSettings(patch: Partial<AppSettings>) {
  cache = { ...getSettings(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...cache, version: SETTINGS_VERSION }))
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
