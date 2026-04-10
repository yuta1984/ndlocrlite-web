/**
 * db.ts ユーティリティテスト
 * fake-indexeddb で IndexedDB をモック
 */

import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { initDB, saveRun, getAllRuns, clearResults, clearModels } from '../../src/utils/db'
import type { DBRunEntry } from '../../src/types/db'

function makeRunEntry(id: string, createdAt?: number): DBRunEntry {
  return {
    id,
    files: [
      {
        fileName: `${id}.png`,
        imageDataUrl: 'data:image/png;base64,test',
        textBlocks: [],
        fullText: `text for ${id}`,
        processingTimeMs: 100,
      },
    ],
    createdAt: createdAt ?? Date.now(),
  }
}

// fake-indexeddb はグローバルに自動登録される
// テスト間のDB分離: 各テスト前にデータをクリア
beforeEach(async () => {
  await initDB() // DB初期化を保証
  await clearResults()
})

// ============================================================
// initDB
// ============================================================
describe('initDB', () => {
  it('IDBDatabase インスタンスを返す', async () => {
    const db = await initDB()
    expect(db).toBeDefined()
    expect(db.name).toBe('NDLOCRLiteDB')
  })

  it('models と results ストアが作成される', async () => {
    const db = await initDB()
    expect(db.objectStoreNames.contains('models')).toBe(true)
    expect(db.objectStoreNames.contains('results')).toBe(true)
  })
})

// ============================================================
// saveRun / getAllRuns
// ============================================================
describe('saveRun / getAllRuns', () => {
  it('エントリを保存して取得できる', async () => {
    const entry = makeRunEntry('run-1', 1000)
    await saveRun(entry)

    const runs = await getAllRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].id).toBe('run-1')
    expect(runs[0].files[0].fullText).toBe('text for run-1')
  })

  it('複数エントリを降順（新しい順）で取得', async () => {
    await saveRun(makeRunEntry('run-old', 1000))
    await saveRun(makeRunEntry('run-new', 2000))

    const runs = await getAllRuns()
    expect(runs).toHaveLength(2)
    // 新しい順
    expect(runs[0].id).toBe('run-new')
    expect(runs[1].id).toBe('run-old')
  })

  it('同じIDで再保存すると上書きされる', async () => {
    const entry1 = makeRunEntry('run-1', 1000)
    await saveRun(entry1)

    const entry2 = makeRunEntry('run-1', 2000)
    entry2.files[0].fullText = 'updated text'
    await saveRun(entry2)

    const runs = await getAllRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].files[0].fullText).toBe('updated text')
  })
})

// ============================================================
// 100件制限 FIFO
// ============================================================
describe('100件上限 FIFO', () => {
  it('100件を超えると最古が削除される', async () => {
    // 100件保存
    for (let i = 0; i < 100; i++) {
      await saveRun(makeRunEntry(`run-${i}`, i * 1000))
    }

    let runs = await getAllRuns()
    expect(runs).toHaveLength(100)

    // 101件目を保存
    await saveRun(makeRunEntry('run-100', 100_000))

    runs = await getAllRuns()
    expect(runs).toHaveLength(100)
    // 最古の run-0 が削除されている
    expect(runs.find(r => r.id === 'run-0')).toBeUndefined()
    // 最新の run-100 が存在する
    expect(runs.find(r => r.id === 'run-100')).toBeDefined()
  })
})

// ============================================================
// clearResults
// ============================================================
describe('clearResults', () => {
  it('全 results をクリア', async () => {
    await saveRun(makeRunEntry('run-1'))
    await saveRun(makeRunEntry('run-2'))
    await clearResults()

    const runs = await getAllRuns()
    expect(runs).toHaveLength(0)
  })
})

// ============================================================
// clearModels
// ============================================================
describe('clearModels', () => {
  it('models ストアをクリアしてもエラーにならない', async () => {
    await expect(clearModels()).resolves.toBeUndefined()
  })
})
