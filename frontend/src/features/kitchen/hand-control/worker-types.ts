import type { HandSample } from './gesture';

export type HandDelegate = 'CPU' | 'GPU';
export type HandWorkerRequest =
  | { type: 'init'; model: ArrayBuffer; delegate: HandDelegate }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number }
  | { type: 'close' };
export type HandWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; sample: HandSample | null; duration: number; timestamp: number }
  | { type: 'error'; message: string };
