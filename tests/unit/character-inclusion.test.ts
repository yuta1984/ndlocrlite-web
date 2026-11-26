import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseInclusionCsv, applyCharacterInclusion } from '../../src/utils/character-inclusion'
import { ROOT, FIXTURES } from '../helpers'

const mapping = parseInclusionCsv(fs.readFileSync(path.join(ROOT, 'public/config/character_inclusion_mapping.csv'), 'utf-8'))
const expected: Record<string, { input: string; output: string }> = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'character-inclusion', 'expected.json'), 'utf-8')
)

describe('異体字の包摂（本家 character_inclusion.py 互換）', () => {
  it('対応表を読み込める', () => {
    expect(mapping.single.size + mapping.multi.size).toBe(4905)
  })

  for (const [name, { input, output }] of Object.entries(expected)) {
    it(`本家と同じ出力: ${name}`, () => {
      expect(applyCharacterInclusion(input, mapping)).toBe(output)
    })
  }

  it('例: 旧字体を新字体に変換', () => {
    expect(applyCharacterInclusion('國語', mapping)).toBe('国語')
  })
})
