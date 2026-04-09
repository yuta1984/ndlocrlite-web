import { ja } from './ja'
import { en } from './en'
import { zh } from './zh'
import { ko } from './ko'

export type Language = 'ja' | 'en' | 'zh' | 'ko'
export type TranslationParams = Record<string, string | number>

const translations = { ja, en, zh, ko }

function getNestedValue(obj: Record<string, unknown>, key: string): string {
  const parts = key.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return key
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : key
}

export function createTranslator(lang: Language) {
  return function t(key: string, params?: TranslationParams): string {
    let text = getNestedValue(translations[lang] as unknown as Record<string, unknown>, key)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v))
      }
    }
    return text
  }
}

export const LANG_STORAGE_KEY = 'ndlocrlite_lang'

export function getStoredLang(): Language {
  const stored = localStorage.getItem(LANG_STORAGE_KEY)
  if (stored === 'en' || stored === 'zh' || stored === 'ko') return stored
  return 'ja'
}
