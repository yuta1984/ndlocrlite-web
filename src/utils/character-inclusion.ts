/**
 * 異体字の包摂（旧字体・異体字 → 新字体）
 * 本家 ndlocr-lite v2 src/character_inclusion.py の移植
 * 対応表: public/config/character_inclusion_mapping.csv
 *   （出典: 国立国会図書館 次世代デジタルライブラリー jd_book.json の mapping char filter）
 *
 * 複数文字の置換を最長一致で先に適用し、その後 1 文字単位の置換を行う
 */

export interface InclusionMapping {
  single: Map<string, string>
  multi: Map<string, string>
  multiPattern: RegExp | null
}

const MAPPING_URL = '/config/character_inclusion_mapping.csv'

export function parseInclusionCsv(csv: string): InclusionMapping {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0)
  const header = lines.shift()?.split(',') ?? []
  const expected = ['source', 'target', 'source_codepoints', 'target_codepoints']
  if (header.join(',') !== expected.join(',')) {
    throw new Error(`Unexpected inclusion mapping columns: ${header.join(',')}`)
  }
  const single = new Map<string, string>()
  const multi = new Map<string, string>()
  for (const line of lines) {
    const [source, target] = line.split(',')
    if (!source) throw new Error('Inclusion mapping sources must not be empty')
    if (single.has(source) || multi.has(source)) throw new Error(`Duplicate inclusion mapping source: ${source}`)
    if (Array.from(source).length === 1) single.set(source, target ?? '')
    else multi.set(source, target ?? '')
  }
  let multiPattern: RegExp | null = null
  if (multi.size > 0) {
    const sources = [...multi.keys()].sort((a, b) => Array.from(b).length - Array.from(a).length)
    multiPattern = new RegExp(sources.map(escapeRegExp).join('|'), 'gu')
  }
  return { single, multi, multiPattern }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function applyCharacterInclusion(text: string, mapping: InclusionMapping): string {
  if (!text) return text
  let out = text
  if (mapping.multiPattern) out = out.replace(mapping.multiPattern, (m) => mapping.multi.get(m) ?? m)
  let result = ''
  for (const ch of out) result += mapping.single.get(ch) ?? ch
  return result
}

let mappingPromise: Promise<InclusionMapping> | null = null

/** 対応表を取得（初回のみ fetch） */
export function loadInclusionMapping(url = MAPPING_URL): Promise<InclusionMapping> {
  if (!mappingPromise) {
    mappingPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load inclusion mapping: ${r.status}`)
        return r.text()
      })
      .then(parseInclusionCsv)
    mappingPromise.catch(() => { mappingPromise = null })
  }
  return mappingPromise
}
