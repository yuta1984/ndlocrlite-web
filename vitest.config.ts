import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000, // ONNX model download + inference can be slow
    pool: 'forks',        // onnxruntime-node needs separate process
  },
})
