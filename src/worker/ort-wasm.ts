/**
 * onnxruntime-web/wasm（CPU 専用ビルド）を使うよう設定する
 * Vite の ?url import でハッシュ付き WASM URL を取得し、CDN 不要・COEP 対応の同一オリジン配信にする
 */
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { setOrt, isNode, type OrtModule } from './onnx-config'

if (!isNode) ort.env.wasm.wasmPaths = { wasm: wasmUrl }
// 認識 Worker は複数並列で動かすため、各 Worker 内はシングルスレッド
ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false
ort.env.logLevel = 'warning'

setOrt(ort as unknown as OrtModule)

export { ort }
