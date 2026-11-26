import type { RGBAImage } from '../worker/image-ops'
import type { RecModelKey } from '../worker/recognizer-config'

export interface RecJob {
  id: number
  model: RecModelKey
  image: RGBAImage
}

export type RecWorkerInMessage =
  | { type: 'REC_INIT'; singleModel?: boolean }
  | { type: 'REC_PROCESS'; batchId: number; jobs: RecJob[] }
  | { type: 'REC_TERMINATE' }

export type RecWorkerOutMessage =
  | { type: 'REC_READY' }
  | { type: 'REC_PROGRESS'; model: RecModelKey; progress: number }
  | { type: 'REC_COMPLETE'; batchId: number; results: Array<{ id: number; text: string }> }
  | { type: 'REC_ERROR'; batchId?: number; error: string }
