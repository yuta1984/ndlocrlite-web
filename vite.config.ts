import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      // index.html 内の %VITE_GA_MEASUREMENT_ID% を置換
      {
        name: 'html-env-replace',
        transformIndexHtml(html) {
          return html.replace(
            /%VITE_GA_MEASUREMENT_ID%/g,
            env.VITE_GA_MEASUREMENT_ID || ''
          )
        },
      },
    ],

    // ONNX Runtime Web: Viteのesbuildプリバンドルを除外（WASMバイナリが壊れるのを防ぐ）
    optimizeDeps: {
      exclude: ['onnxruntime-web', 'onnxruntime-web/wasm'],
    },

    // WASMとONNXファイルをアセットとして認識
    assetsInclude: ['**/*.wasm', '**/*.onnx'],

    build: {
      target: 'esnext',
    },

    // Web WorkerをES moduleフォーマットで出力
    worker: {
      format: 'es',
    },

    server: {
      // SharedArrayBuffer用のCOOP/COEPヘッダー（onnxruntime-webのマルチスレッド推論に必要）
      // credentialless: クロスオリジン(HuggingFace CDN)からのモデルダウンロードを許可
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' 'unsafe-eval' https://www.googletagmanager.com; connect-src 'self' https://huggingface.co https://*.huggingface.co https://www.google-analytics.com https://www.googletagmanager.com ws:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:",
      },
    },
  }
})
