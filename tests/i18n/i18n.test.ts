/**
 * i18n モジュールテスト
 * createTranslator / getStoredLang の検証
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createTranslator, getStoredLang, LANG_STORAGE_KEY, type Language } from '../../src/i18n'

// localStorage モック
const storage: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => storage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { storage[key] = value }),
  removeItem: vi.fn((key: string) => { delete storage[key] }),
  clear: vi.fn(() => { for (const key of Object.keys(storage)) delete storage[key] }),
  get length() { return Object.keys(storage).length },
  key: vi.fn((idx: number) => Object.keys(storage)[idx] ?? null),
}

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

// ============================================================
// createTranslator
// ============================================================
describe('createTranslator', () => {
  it('日本語のキーを正しく解決する', () => {
    const t = createTranslator('ja')
    expect(t('app.title')).toBe('Web OCR')
  })

  it('英語のキーを正しく解決する', () => {
    const t = createTranslator('en')
    expect(t('app.title')).toBe('Web OCR')
  })

  it('中国語のキーを正しく解決する', () => {
    const t = createTranslator('zh')
    expect(t('app.title')).toBe('Web OCR')
  })

  it('韓国語のキーを正しく解決する', () => {
    const t = createTranslator('ko')
    expect(t('app.title')).toBe('Web OCR')
  })

  it('ネストしたキーを解決する', () => {
    const t = createTranslator('ja')
    expect(t('upload.startButton')).toBe('OCR開始')
  })

  it('存在しないキーはキーそのものを返す', () => {
    const t = createTranslator('ja')
    expect(t('nonexistent.key')).toBe('nonexistent.key')
  })

  it('パラメータ置換が動作する', () => {
    const t = createTranslator('ja')
    const result = t('progress.processing', { current: 2, total: 5 })
    expect(result).toBe('処理中: 2/5 ファイル')
  })

  it('複数パラメータの置換', () => {
    const t = createTranslator('ja')
    const result = t('progress.textRecognition', { current: 3, total: 10 })
    expect(result).toBe('文字認識中 (3/10 領域)')
  })

  it('各言語で同一キーが存在する', () => {
    const langs: Language[] = ['ja', 'en', 'zh', 'ko']
    const requiredKeys = ['app.title', 'upload.startButton', 'results.copy', 'progress.done']

    for (const lang of langs) {
      const t = createTranslator(lang)
      for (const key of requiredKeys) {
        const value = t(key)
        expect(value, `Missing key "${key}" in "${lang}"`).not.toBe(key)
      }
    }
  })
})

// ============================================================
// getStoredLang
// ============================================================
describe('getStoredLang', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('未保存時はデフォルト "ja" を返す', () => {
    expect(getStoredLang()).toBe('ja')
  })

  it('保存された "en" を返す', () => {
    storage[LANG_STORAGE_KEY] = 'en'
    expect(getStoredLang()).toBe('en')
  })

  it('保存された "zh" を返す', () => {
    storage[LANG_STORAGE_KEY] = 'zh'
    expect(getStoredLang()).toBe('zh')
  })

  it('保存された "ko" を返す', () => {
    storage[LANG_STORAGE_KEY] = 'ko'
    expect(getStoredLang()).toBe('ko')
  })

  it('不正な値が保存されていたら "ja" にフォールバック', () => {
    storage[LANG_STORAGE_KEY] = 'invalid'
    expect(getStoredLang()).toBe('ja')
  })
})

// ============================================================
// LANG_STORAGE_KEY
// ============================================================
describe('LANG_STORAGE_KEY', () => {
  it('文字列定数が定義されている', () => {
    expect(typeof LANG_STORAGE_KEY).toBe('string')
    expect(LANG_STORAGE_KEY.length).toBeGreaterThan(0)
  })
})
