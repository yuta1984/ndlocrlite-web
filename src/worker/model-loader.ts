/**
 * モデルファイルのダウンロード・IndexedDBキャッシュ管理
 * 参照実装: ndlkotenocr-worker/src/utils/model-loader.js
 */

import { MODEL_FILES, MODEL_SHA256, type ModelKey } from './model-files'

const DB_NAME = 'NDLOCRLiteDB'
const DB_VERSION = 2
const STORE_NAME = 'models'

// モデルのバージョン（URLが変わったらここを更新）
export const MODEL_VERSION = '3.0.0'

// モデル配信ベースURL（環境変数 VITE_MODEL_BASE_URL で指定、末尾スラッシュなし）
// 開発時は .env.local で VITE_MODEL_BASE_URL=/models/dev のようにローカル配信に切り替える
const MODEL_BASE_URL = ((import.meta.env.VITE_MODEL_BASE_URL as string | undefined) ?? '').replace(/\/$/, '')

// ONNXモデルのファイル名（すべて MODEL_BASE_URL 配下。NDLOCR-Lite v2.0.0）
const MODEL_FILE_NAMES: Record<string, string> = { ...MODEL_FILES }

export const MODEL_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(MODEL_FILE_NAMES).map(([k, f]) => [k, `${MODEL_BASE_URL}/${f}`])
)

function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models', { keyPath: 'name' })
      }
      // Version 2: results ストアを再作成（per-run スキーマ）
      if (db.objectStoreNames.contains('results')) {
        db.deleteObjectStore('results')
      }
      const resultsStore = db.createObjectStore('results', { keyPath: 'id' })
      resultsStore.createIndex('by_createdAt', 'createdAt', { unique: false })
    }
  })
}

async function getModelFromCache(
  modelName: string
): Promise<ArrayBuffer | undefined> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(modelName)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const entry = request.result
      if (entry && entry.version === MODEL_VERSION) {
        resolve(entry.data)
      } else {
        resolve(undefined)
      }
    }
  })
}

async function saveModelToCache(
  modelName: string,
  data: ArrayBuffer
): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.put({
      name: modelName,
      data,
      cachedAt: Date.now(),
      version: MODEL_VERSION,
    })

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

async function downloadWithProgress(
  url: string,
  onProgress?: (progress: number) => void
): Promise<ArrayBuffer> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  // SPAフォールバックでHTMLが返った場合（モデルファイルが存在しない）を検出
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/html')) {
    throw new Error(`Model file not found (HTML returned): ${url}`)
  }

  const contentLength = parseInt(
    response.headers.get('content-length') || '0',
    10
  )
  let receivedLength = 0

  const reader = response.body!.getReader()
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    chunks.push(value)
    receivedLength += value.length

    if (onProgress && contentLength > 0) {
      onProgress(receivedLength / contentLength)
    }
  }

  const allChunks = new Uint8Array(receivedLength)
  let position = 0
  for (const chunk of chunks) {
    allChunks.set(chunk, position)
    position += chunk.length
  }

  return allChunks.buffer
}

export async function loadModel(
  modelType: string,
  onProgress?: (progress: number) => void
): Promise<ArrayBuffer> {
  const modelUrl = MODEL_URLS[modelType]
  if (!modelUrl) {
    throw new Error(`Unknown model type: ${modelType}`)
  }

  const cached = await getModelFromCache(modelType)
  if (cached) {
    console.log(`Model ${modelType} loaded from cache`)
    if (onProgress) onProgress(1.0)
    return cached
  }

  console.log(`Downloading model ${modelType} from ${modelUrl}`)
  const modelData = await downloadWithProgress(modelUrl, onProgress)

  // 外部ホスト（GitHub raw / R2）から取得するため、本家公表の SHA-256 と照合してからキャッシュする
  const expected = MODEL_SHA256[modelType as ModelKey]
  if (expected) {
    const digest = await crypto.subtle.digest('SHA-256', modelData)
    const actual = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    if (actual !== expected) {
      throw new Error(`Model ${modelType} checksum mismatch (expected ${expected}, got ${actual})`)
    }
  }

  await saveModelToCache(modelType, modelData)
  console.log(`Model ${modelType} cached successfully`)

  return modelData
}

export async function clearModelCache(): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.clear()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}
