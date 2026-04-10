/**
 * model-loader.ts テスト
 * 公開 API の検証 + ハッシュ整合性ロジック
 */

import { describe, it, expect } from 'vitest'
import {
  MODEL_URLS,
  MODEL_VERSION,
  getRecModelKey,
} from '../../src/worker/model-loader'

// ============================================================
// MODEL_URLS
// ============================================================
describe('MODEL_URLS', () => {
  it('det キーが存在する', () => {
    expect(MODEL_URLS).toHaveProperty('det')
    expect(MODEL_URLS.det).toContain('.onnx')
  })

  it('全認識モデルキーが存在する', () => {
    const expectedKeys = ['rec_chinese', 'rec_english', 'rec_korean', 'rec_latin']
    for (const key of expectedKeys) {
      expect(MODEL_URLS, `Missing key: ${key}`).toHaveProperty(key)
      expect(MODEL_URLS[key]).toContain('.onnx')
    }
  })

  it('全URLがHTTPSで始まる', () => {
    for (const [key, url] of Object.entries(MODEL_URLS)) {
      expect(url, `URL for ${key} should use HTTPS`).toMatch(/^https:\/\//)
    }
  })

  it('全URLがHuggingFace CDNを指す', () => {
    for (const [key, url] of Object.entries(MODEL_URLS)) {
      expect(url, `URL for ${key} should be on HuggingFace`).toContain('huggingface.co')
    }
  })
})

// ============================================================
// MODEL_VERSION
// ============================================================
describe('MODEL_VERSION', () => {
  it('空でない文字列', () => {
    expect(MODEL_VERSION).toBeTruthy()
    expect(typeof MODEL_VERSION).toBe('string')
  })

  it('paddleocr バージョンを含む', () => {
    expect(MODEL_VERSION).toContain('paddleocr')
  })
})

// ============================================================
// getRecModelKey
// ============================================================
describe('getRecModelKey', () => {
  it('chinese → rec_chinese', () => {
    expect(getRecModelKey('chinese')).toBe('rec_chinese')
  })

  it('english → rec_english', () => {
    expect(getRecModelKey('english')).toBe('rec_english')
  })

  it('korean → rec_korean', () => {
    expect(getRecModelKey('korean')).toBe('rec_korean')
  })

  it('latin → rec_latin', () => {
    expect(getRecModelKey('latin')).toBe('rec_latin')
  })

  it('返り値が MODEL_URLS のキーと一致する', () => {
    const languages = ['chinese', 'english', 'korean', 'latin']
    for (const lang of languages) {
      const key = getRecModelKey(lang)
      expect(MODEL_URLS, `getRecModelKey('${lang}') = '${key}' should be in MODEL_URLS`).toHaveProperty(key)
    }
  })
})

// ============================================================
// verifyModelIntegrity (間接テスト: crypto.subtle でハッシュ検証ロジック確認)
// ============================================================
describe('SHA-256 hash verification logic', () => {
  it('正しいデータの SHA-256 ハッシュを計算できる', async () => {
    const data = new TextEncoder().encode('test data')
    const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    // "test data" の既知の SHA-256
    expect(hashHex).toBe('916f0027a575074ce72a331777c3478d6513f786a591bd892da1a577bf2335f9')
  })

  it('異なるデータは異なるハッシュを生成する', async () => {
    const data1 = new TextEncoder().encode('data1')
    const data2 = new TextEncoder().encode('data2')

    const hash1 = await crypto.subtle.digest('SHA-256', data1.buffer)
    const hash2 = await crypto.subtle.digest('SHA-256', data2.buffer)

    const hex1 = Array.from(new Uint8Array(hash1)).map(b => b.toString(16).padStart(2, '0')).join('')
    const hex2 = Array.from(new Uint8Array(hash2)).map(b => b.toString(16).padStart(2, '0')).join('')

    expect(hex1).not.toBe(hex2)
  })
})
