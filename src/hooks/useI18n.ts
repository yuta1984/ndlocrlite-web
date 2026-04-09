import { useState, useCallback } from 'react'
import {
  type Language,
  type TranslationParams,
  createTranslator,
  getStoredLang,
  LANG_STORAGE_KEY,
} from '../i18n'

export function useI18n() {
  const [lang, setLang] = useState<Language>(getStoredLang)

  const t = useCallback(
    (key: string, params?: TranslationParams) => createTranslator(lang)(key, params),
    [lang]
  )

  const setLanguage = useCallback((next: Language) => {
    setLang(next)
    localStorage.setItem(LANG_STORAGE_KEY, next)
  }, [])

  const toggleLanguage = useCallback(() => {
    const cycle: Language[] = ['ja', 'en', 'zh', 'ko']
    const idx = cycle.indexOf(lang)
    const next = cycle[(idx + 1) % cycle.length]
    setLanguage(next)
  }, [lang, setLanguage])

  return { lang, t, toggleLanguage, setLanguage }
}
