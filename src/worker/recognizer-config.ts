/**
 * 文字認識（PARSeq）カスケードモデルの定義
 * ocr.worker / recognition.worker / テストで共通利用する（入力 shape の修正漏れ防止）
 */

export type RecModelKey = 'recognition30' | 'recognition50' | 'recognition100'

export interface RecModelSpec {
  key: RecModelKey
  /** ONNX 入力 shape [N, C, H, W] */
  inputShape: [number, number, number, number]
}

export const REC_MODELS: Record<RecModelKey, RecModelSpec> = {
  recognition30: { key: 'recognition30', inputShape: [1, 3, 24, 256] },
  recognition50: { key: 'recognition50', inputShape: [1, 3, 24, 384] },
  recognition100: { key: 'recognition100', inputShape: [1, 3, 24, 768] },
}

export const REC_MODEL_KEYS: RecModelKey[] = ['recognition30', 'recognition50', 'recognition100']

/** DEIM の char_count カテゴリ（3: ≤30字, 2: ≤50字, その他: ≤100字）から初段モデルを選ぶ */
export function initialModelForCategory(category: number | undefined): RecModelKey {
  if (category === 3) return 'recognition30'
  if (category === 2) return 'recognition50'
  return 'recognition100'
}
