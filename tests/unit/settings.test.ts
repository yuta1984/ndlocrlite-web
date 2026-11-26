import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, migrate } from '../../src/utils/settings'

describe('設定', () => {
  it('表構造推定は既定で有効', () => {
    expect(DEFAULT_SETTINGS.tableStructure).toBe(true)
  })

  it('v1 で off のまま保存されていた設定は一度だけ on に移行する', () => {
    expect(migrate({ ...DEFAULT_SETTINGS, tableStructure: false }, 1).tableStructure).toBe(true)
  })

  it('v2 以降にユーザーが off にした設定はそのまま', () => {
    expect(migrate({ ...DEFAULT_SETTINGS, tableStructure: false }, 2).tableStructure).toBe(false)
  })
})
