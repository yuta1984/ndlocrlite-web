import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // ONNX セッションはメモリを多く使うため、統合テストはファイル単位で直列実行
    fileParallelism: false,
  },
})
