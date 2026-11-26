/**
 * 1 Worker 内で保持する PARSeq カスケードモデル群
 * singleModel=true（モバイル）の場合は rec100 のみをロードし、全行を rec100 で認識する
 */

import { loadModel } from './model-loader'
import { TextRecognizer, loadCharList } from './text-recognizer'
import { REC_MODELS, REC_MODEL_KEYS, type RecModelKey } from './recognizer-config'
import type { RGBAImage } from './image-ops'

export class RecognizerSet {
  private recognizers = new Map<RecModelKey, TextRecognizer>()
  private loading: Promise<void> | null = null
  readonly singleModel: boolean

  constructor(singleModel = false) {
    this.singleModel = singleModel
  }

  get modelKeys(): RecModelKey[] {
    return this.singleModel ? ['recognition100'] : REC_MODEL_KEYS
  }

  get isLoaded(): boolean {
    return this.modelKeys.every((k) => this.recognizers.has(k))
  }

  /** モデルのダウンロード（並列）→ セッション生成（直列） */
  load(onProgress?: (key: RecModelKey, p: number) => void): Promise<void> {
    if (!this.loading) {
      this.loading = (async () => {
        const charList = await loadCharList()
        const datas = await Promise.all(
          this.modelKeys.map((k) => loadModel(k, (p) => onProgress?.(k, p)))
        )
        for (let i = 0; i < this.modelKeys.length; i++) {
          const key = this.modelKeys[i]
          const rec = new TextRecognizer(REC_MODELS[key].inputShape)
          await rec.initialize(datas[i], charList)
          this.recognizers.set(key, rec)
        }
      })()
      this.loading.catch(() => { this.loading = null })
    }
    return this.loading
  }

  /** 指定モデルで認識（singleModel では常に rec100） */
  async recognize(key: RecModelKey, image: RGBAImage): Promise<string> {
    const rec = this.recognizers.get(this.singleModel ? 'recognition100' : key)
    if (!rec) throw new Error(`Recognizer ${key} not loaded`)
    return (await rec.recognizeCropped(image)).text
  }

  dispose(): void {
    for (const r of this.recognizers.values()) r.dispose()
    this.recognizers.clear()
    this.loading = null
  }
}
