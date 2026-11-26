/**
 * Node 上で Web 版と同じモジュールを使って OCR パイプラインを実行するテスト用ランナー
 *
 * 環境変数:
 *   MODELS_DIR  ONNX モデルのディレクトリ（既定: public/models/v2）
 *   MODEL_SET   'v2'（既定）| '202604'
 */
import '../src/worker/ort-wasm'
import fs from 'node:fs'
import path from 'node:path'
import { LayoutDetector } from '../src/worker/layout-detector'
import { TextRecognizer, charListFromYaml } from '../src/worker/text-recognizer'
import { REC_MODELS, type RecModelKey } from '../src/worker/recognizer-config'
import { recognizeCascade, serialize } from '../src/worker/cascade'
import { assemblePage, type AssembledPage } from '../src/worker/assemble'
import { cropRGBA, type RGBAImage } from '../src/worker/image-ops'
import { MODEL_FILES } from '../src/worker/model-files'
import { ROOT } from './helpers'

const LEGACY_202604: Record<string, string> = {
  layout: 'deim-s-1024x1024.onnx',
  recognition30: 'parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx',
  recognition50: 'parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx',
  recognition100: 'parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx',
}

export const MODEL_SET = process.env.MODEL_SET ?? 'v2'
export const MODELS_DIR = process.env.MODELS_DIR ?? path.join(ROOT, 'public', 'models', 'v2')

export function modelPath(key: string): string {
  const files: Record<string, string> = MODEL_SET === '202604' ? LEGACY_202604 : MODEL_FILES
  return path.join(MODELS_DIR, files[key])
}

export function modelsAvailable(): boolean {
  return ['layout', 'recognition30', 'recognition50', 'recognition100'].every((k) => fs.existsSync(modelPath(k)))
}

export interface Pipeline {
  run(image: RGBAImage): Promise<AssembledPage & { lineCount: number; recCalls: Record<string, number> }>
  dispose(): void
}

export async function createPipeline(): Promise<Pipeline> {
  const charList = charListFromYaml(fs.readFileSync(path.join(ROOT, 'public/config/NDLmoji.yaml'), 'utf-8'))
  // LAYOUT_OPTS='{"lineExpandRatio":0}' のように後処理パラメータを上書きできる（比較実験用）
  const layout = new LayoutDetector(process.env.LAYOUT_OPTS ? JSON.parse(process.env.LAYOUT_OPTS) : undefined)
  await layout.initialize(fs.readFileSync(modelPath('layout')))
  const recs = new Map<RecModelKey, TextRecognizer>()
  for (const key of Object.keys(REC_MODELS) as RecModelKey[]) {
    const r = new TextRecognizer(REC_MODELS[key].inputShape)
    await r.initialize(fs.readFileSync(modelPath(key)), charList)
    recs.set(key, r)
  }

  return {
    async run(image) {
      const { lines, blocks } = await layout.detect(image)
      const recCalls: Record<string, number> = {}
      const recognize = serialize(async (model, img) => {
        recCalls[model] = (recCalls[model] ?? 0) + 1
        return (await recs.get(model)!.recognizeCropped(img)).text
      })
      const texts = await recognizeCascade(
        lines.map((r) => ({ image: cropRGBA(image, r.x, r.y, r.width, r.height), charCountCategory: r.charCountCategory })),
        recognize
      )
      return { ...assemblePage(lines, texts, blocks), lineCount: lines.length, recCalls }
    },
    dispose() {
      layout.dispose()
      for (const r of recs.values()) r.dispose()
    },
  }
}
