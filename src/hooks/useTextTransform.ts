import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../utils/settings'
import { applyCharacterInclusion, loadInclusionMapping, type InclusionMapping } from '../utils/character-inclusion'

const identity = (t: string) => t

/**
 * 表示・出力用のテキスト変換を返す
 * 「異体字を新字体に変換」が有効なら包摂を適用（OCR 結果自体は変更しないため、いつでも切り替え可能）
 */
export function useTextTransform(): (text: string) => string {
  const [settings] = useSettings()
  const [mapping, setMapping] = useState<InclusionMapping | null>(null)

  useEffect(() => {
    if (!settings.characterInclusion || mapping) return
    let cancelled = false
    loadInclusionMapping()
      .then((m) => { if (!cancelled) setMapping(m) })
      .catch((err) => console.error('Failed to load character inclusion mapping:', err))
    return () => { cancelled = true }
  }, [settings.characterInclusion, mapping])

  return useMemo(
    () => (settings.characterInclusion && mapping ? (t: string) => applyCharacterInclusion(t, mapping) : identity),
    [settings.characterInclusion, mapping]
  )
}
