/**
 * ONNX Runtime Web の実行時設定
 *
 * Worker ごとに使う ORT ビルドが異なるため、ランタイムを注入できるようにしている
 *   - recognition.worker / テスト: onnxruntime-web/wasm（CPU, 軽量）  … ./ort-wasm.ts
 *   - ocr.worker（レイアウト検出）: onnxruntime-web/webgpu（WebGPU + WASM フォールバック）… ./ort-webgpu.ts
 *
 * LayoutDetector / TextRecognizer は getOrt() 経由で Tensor・InferenceSession を使う
 */

import type * as OrtType from 'onnxruntime-web'

export type OrtModule = typeof OrtType
export type ExecutionBackend = 'webgpu' | 'wasm'

let current: OrtModule | null = null

export function setOrt(ort: OrtModule) {
  current = ort
}

export function getOrt(): OrtModule {
  if (!current) throw new Error('ONNX Runtime is not configured (import ort-wasm or ort-webgpu first)')
  return current
}

export const isNode = typeof self === 'undefined' && typeof process !== 'undefined' && !!process.versions?.node

/** WebGPU が利用可能か（アダプタ取得まで確認） */
export async function isWebGPUAvailable(): Promise<boolean> {
  try {
    const gpu = (globalThis.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } })?.gpu
    if (!gpu) return false
    return !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

export async function createSession(
  modelData: ArrayBuffer | Uint8Array,
  options: Partial<OrtType.InferenceSession.SessionOptions> = {}
): Promise<OrtType.InferenceSession> {
  const ort = getOrt()
  const defaultOptions: OrtType.InferenceSession.SessionOptions = {
    executionProviders: ['wasm'],
    logSeverityLevel: 4,
    graphOptimizationLevel: 'basic',
    enableCpuMemArena: false,
    enableMemPattern: false,
    ...options,
  }
  const data = modelData instanceof Uint8Array ? modelData : new Uint8Array(modelData)
  try {
    return await ort.InferenceSession.create(data, defaultOptions)
  } catch (error) {
    console.error('Failed to create ONNX session:', error)
    throw error
  }
}
