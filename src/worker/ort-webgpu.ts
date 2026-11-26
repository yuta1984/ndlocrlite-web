/**
 * onnxruntime-web/webgpu（WebGPU EP + WASM EP）を使うよう設定する
 * レイアウト検出（DEIM）・表構造認識（TableCenterNet）は WebGPU で大幅に高速化する
 *   実測（M系Mac/Chrome）: DEIM 2.5s → 0.27s、TableCenterNet 1.7s → 0.5s
 * 文字認識（PARSeq）は小さな演算が大量に並ぶ構造のため WebGPU だと逆に遅く、WASM を使う
 */
import * as ort from 'onnxruntime-web/webgpu'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import { setOrt, type OrtModule } from './onnx-config'

// mjs（Emscripten グルーコード）も別ファイルとして明示する。
// 指定しないと本番ビルドでは ORT がバンドル先（= この ocr.worker 自身）をマルチスレッド用の
// pthread Worker として起動してしまい、セッション生成がハングする
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl }
ort.env.wasm.proxy = false
ort.env.logLevel = 'warning'

/**
 * WebGPU が使えない環境で WASM にフォールバックする場合のスレッド数
 * （SharedArrayBuffer = crossOriginIsolated が必要。Netlify で COOP/COEP 設定済み）
 */
export function configureWasmThreads(threads: number) {
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, threads) : 1
}

setOrt(ort as unknown as OrtModule)

export { ort }
