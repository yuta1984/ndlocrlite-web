/**
 * useI18n フックテスト
 * @vitest-environment jsdom
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { LANG_STORAGE_KEY } from '../../src/i18n'
import { useI18n } from '../../src/hooks/useI18n'

beforeEach(() => {
  localStorage.clear()
})

describe('useI18n', () => {
  it('デフォルト言語は ja', () => {
    const { result } = renderHook(() => useI18n())
    expect(result.current.lang).toBe('ja')
  })

  it('localStorage に保存された言語を読み取る', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'en')
    const { result } = renderHook(() => useI18n())
    expect(result.current.lang).toBe('en')
  })

  it('setLanguage で言語を切り替える', () => {
    const { result } = renderHook(() => useI18n())
    act(() => result.current.setLanguage('zh'))
    expect(result.current.lang).toBe('zh')
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('zh')
  })

  it('toggleLanguage で ja→en→zh→ko→ja とサイクルする', () => {
    const { result } = renderHook(() => useI18n())
    expect(result.current.lang).toBe('ja')

    act(() => result.current.toggleLanguage())
    expect(result.current.lang).toBe('en')

    act(() => result.current.toggleLanguage())
    expect(result.current.lang).toBe('zh')

    act(() => result.current.toggleLanguage())
    expect(result.current.lang).toBe('ko')

    act(() => result.current.toggleLanguage())
    expect(result.current.lang).toBe('ja')
  })

  it('t() で翻訳キーを解決する', () => {
    const { result } = renderHook(() => useI18n())
    expect(result.current.t('app.title')).toBe('Web OCR')
  })

  it('t() でパラメータ置換する', () => {
    const { result } = renderHook(() => useI18n())
    const text = result.current.t('progress.processing', { current: 3, total: 10 })
    expect(text).toBe('処理中: 3/10 ファイル')
  })

  it('言語切替後に t() の出力が変わる', () => {
    const { result } = renderHook(() => useI18n())
    const jaText = result.current.t('upload.startButton')
    expect(jaText).toBe('OCR開始')

    act(() => result.current.setLanguage('en'))
    const enText = result.current.t('upload.startButton')
    expect(enText).not.toBe(jaText)
  })

  it('setLanguage で localStorage に永続化される', () => {
    const { result } = renderHook(() => useI18n())
    act(() => result.current.setLanguage('ko'))
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('ko')

    // 再マウントで保持
    const { result: result2 } = renderHook(() => useI18n())
    expect(result2.current.lang).toBe('ko')
  })
})
