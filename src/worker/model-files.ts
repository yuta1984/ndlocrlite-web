/**
 * NDLOCR-Lite v2.0.0 の ONNX モデルファイル名
 * 配布元: https://lab.ndl.go.jp/dataset/ndlocr-lite/onnx/v2/ （CORS 非対応のため R2 等に再配置して利用）
 */
export const MODEL_FILES = {
  layout: 'deim-s-1024x1024-261124.onnx',
  recognition30: 'parseq-ndl-24x256-30-tiny-499epoch-261124.onnx',
  recognition50: 'parseq-ndl-24x384-50-tiny-278epoch-261124.onnx',
  recognition100: 'parseq-ndl-24x768-100-tiny-153epoch-261124.onnx',
  table: 'tablecenternet_s_800_v3.onnx',
} as const

export type ModelKey = keyof typeof MODEL_FILES

/** SHA-256（本家 model_download.py より） */
export const MODEL_SHA256: Record<ModelKey, string> = {
  layout: 'f9a41c8453dd687f370bee199fd6d47ecf583cc14f1d839a0b416db39b356e8c',
  recognition30: '063ec5b3201bce79d56c3ad73b5726cf76ec6a82f42e11a89466ae683755296c',
  recognition50: 'd3dd9e7733aeff5c9f50687c7da6e8d01915a0bf07cfbefe1d9ac58241c61471',
  recognition100: '06462b0dbd5b0b8508545c8c3d485cf20dbf4ffa652fe145e69c9e7457080602',
  table: 'fc26e20e0ece97be0d03b495481c33a3982f268966920297061b8c90215cdefa',
}
