/**
 * useResultCache フックテスト
 * fake-indexeddb + @testing-library/react
 * @vitest-environment jsdom
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useResultCache } from '../../src/hooks/useResultCache'
import { clearResults, initDB } from '../../src/utils/db'
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

beforeEach(async () => {
  await initDB()
  await clearResults()
})

describe('useResultCache', () => {
  it('初期状態では isLoading=true → false、runs は空', async () => {
    const { result } = renderHook(() => useResultCache())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.runs).toEqual([])
  })

  it('saveRun でエントリを保存して runs に反映される', async () => {
    const { result } = renderHook(() => useResultCache())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.saveRun(makeRunEntry('run-1'))
    })

    expect(result.current.runs).toHaveLength(1)
    expect(result.current.runs[0].id).toBe('run-1')
  })

  it('複数エントリを保存して新しい順で取得', async () => {
    const { result } = renderHook(() => useResultCache())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.saveRun(makeRunEntry('run-old', 1000))
    })
    await act(async () => {
      await result.current.saveRun(makeRunEntry('run-new', 2000))
    })

    expect(result.current.runs).toHaveLength(2)
    expect(result.current.runs[0].id).toBe('run-new')
    expect(result.current.runs[1].id).toBe('run-old')
  })

  it('clearResults で全エントリが削除される', async () => {
    const { result } = renderHook(() => useResultCache())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.saveRun(makeRunEntry('run-1'))
    })
    expect(result.current.runs).toHaveLength(1)

    await act(async () => {
      await result.current.clearResults()
    })
    expect(result.current.runs).toHaveLength(0)
  })
})
