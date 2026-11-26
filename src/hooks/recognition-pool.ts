/**
 * 認識 Worker プール（メインスレッド側）
 * ジョブキューから空いている Worker に小バッチで分配する（カスケードの再認識ジョブも同じキューに入る）
 */

import type { RecJob, RecWorkerInMessage, RecWorkerOutMessage } from '../types/recognition-worker'
import type { RGBAImage } from '../worker/image-ops'
import type { RecModelKey } from '../worker/recognizer-config'
// ?worker import → Vite が recognition.worker.ts を独立バンドルして Worker コンストラクタを返す
import RecognitionWorkerFactory from '../worker/recognition.worker.ts?worker'

interface PendingJob {
  job: RecJob
  resolve: (text: string) => void
  reject: (err: Error) => void
}

interface PoolWorker {
  worker: Worker
  ready: boolean
  busy: boolean
  inflight: Map<number, PendingJob>
}

const BATCH_SIZE = 4

export class RecognitionPool {
  private workers: PoolWorker[] = []
  private queue: PendingJob[] = []
  private nextJobId = 1
  private nextBatchId = 1

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      this.workers.push({ worker: new RecognitionWorkerFactory(), ready: false, busy: false, inflight: new Map() })
    }
  }

  get size(): number {
    return this.workers.length
  }

  /**
   * 全 Worker のモデル読み込み完了を待つ
   * 先頭の Worker がダウンロード + IndexedDB キャッシュを行い、残りはキャッシュから並列に読み込む
   * （全 Worker が同時にダウンロードすると通信量が Worker 数倍になるため）
   */
  async init(singleModel: boolean, onModelProgress?: (model: RecModelKey, p: number) => void): Promise<void> {
    if (this.workers.length === 0) return
    const [first, ...rest] = this.workers
    await this.initWorker(first, singleModel, onModelProgress)
    await Promise.all(rest.map((pw) => this.initWorker(pw, singleModel)))
  }

  private initWorker(pw: PoolWorker, singleModel: boolean, onModelProgress?: (model: RecModelKey, p: number) => void) {
    return new Promise<void>((resolve, reject) => {
      pw.worker.onmessage = (e: MessageEvent<RecWorkerOutMessage>) => {
        const msg = e.data
        if (msg.type === 'REC_PROGRESS') {
          onModelProgress?.(msg.model, msg.progress)
        } else if (msg.type === 'REC_READY') {
          pw.worker.onmessage = (ev: MessageEvent<RecWorkerOutMessage>) => this.handleMessage(pw, ev.data)
          pw.ready = true
          resolve()
          this.pump()
        } else if (msg.type === 'REC_ERROR') {
          reject(new Error(msg.error))
        }
      }
      pw.worker.postMessage({ type: 'REC_INIT', singleModel } satisfies RecWorkerInMessage)
    })
  }

  recognize(model: RecModelKey, image: RGBAImage): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job: { id: this.nextJobId++, model, image }, resolve, reject })
      this.pump()
    })
  }

  private pump() {
    for (const pw of this.workers) {
      if (this.queue.length === 0) return
      if (!pw.ready || pw.busy) continue
      const batch = this.queue.splice(0, BATCH_SIZE)
      pw.busy = true
      for (const p of batch) pw.inflight.set(p.job.id, p)
      const jobs = batch.map((p) => p.job)
      // 行画像は小さいため structured clone でコピー送信する
      // （カスケードで同じ画像を別モデルへ再投入するため transfer しない）
      pw.worker.postMessage({ type: 'REC_PROCESS', batchId: this.nextBatchId++, jobs } satisfies RecWorkerInMessage)
    }
  }

  private handleMessage(pw: PoolWorker, msg: RecWorkerOutMessage) {
    if (msg.type === 'REC_COMPLETE') {
      for (const r of msg.results) {
        pw.inflight.get(r.id)?.resolve(r.text)
        pw.inflight.delete(r.id)
      }
    } else if (msg.type === 'REC_ERROR') {
      const err = new Error(msg.error)
      for (const p of pw.inflight.values()) p.reject(err)
      pw.inflight.clear()
    } else {
      return
    }
    pw.busy = false
    this.pump()
  }

  terminate() {
    for (const pw of this.workers) {
      pw.worker.postMessage({ type: 'REC_TERMINATE' } satisfies RecWorkerInMessage)
      pw.worker.terminate()
    }
    this.workers = []
    const err = new Error('Recognition pool terminated')
    for (const p of this.queue) p.reject(err)
    this.queue = []
  }
}
