/**
 * モデルファイルのダウンロード・IndexedDBキャッシュ管理
 * PaddleOCR ONNX モデル（HuggingFace CDN 配信）
 */

const DB_NAME = 'NDLOCRLiteDB'
const DB_VERSION = 2
const STORE_NAME = 'models'

// モデルのバージョン（モデル変更時にここを更新してキャッシュ無効化）
export const MODEL_VERSION = '2.0.0-paddleocr'

// HuggingFace CDN ベースURL
const HF_BASE = 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main'

// ONNXモデルのURL（PaddleOCR PP-OCRv5）
export const MODEL_URLS: Record<string, string> = {
  det: `${HF_BASE}/detection/v5/det.onnx`,
  rec_chinese: `${HF_BASE}/languages/chinese/rec.onnx`,
  rec_english: `${HF_BASE}/languages/english/rec.onnx`,
  rec_korean: `${HF_BASE}/languages/korean/rec.onnx`,
  rec_latin: `${HF_BASE}/languages/latin/rec.onnx`,
}

// 各モデルの SHA-256 ハッシュ（整合性検証用）
const MODEL_HASHES: Record<string, string> = {
  det: '61824840edf6e74581898930b8091b1b2318f4b2705a2e8a40ad3de7ac480133',
  rec_chinese: '26fa4f47060f58e25962b9af6beaee05c8182b90e026c4ecc6db165d9dfdc38a',
  rec_english: '4e16deb22c4da6468bdca539b2cd3c8687825538b67109177c47d359ab994cd7',
  rec_korean: '322f140154c820fcb83c3d24cfe42c9ec70dd1a1834163306a7338136e4f1eaa',
  rec_latin: '614ffc2d6d3902d360fad7f1b0dd455ee45e877069d14c4e51a99dc4ef144409',
}

async function verifyModelIntegrity(
  modelType: string,
  data: ArrayBuffer
): Promise<void> {
  const expectedHash = MODEL_HASHES[modelType]
  if (!expectedHash) return

  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  if (hashHex !== expectedHash) {
    throw new Error(
      `Model integrity check failed for ${modelType}: expected ${expectedHash}, got ${hashHex}`
    )
  }
}

// 言語→認識モデルキーのマッピング
export function getRecModelKey(language: string): string {
  return `rec_${language}`
}

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

  await verifyModelIntegrity(modelType, modelData)

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
