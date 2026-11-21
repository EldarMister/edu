import { PTT_EVENTS, type PttBatchPayload, type PttFreePayload, type PttOpusCodec } from './types';

const OPUS_HEADER_BYTES = 16;
const FRAMES_PER_BATCH = 4;

export function createPttBatcher(frameBytes: number, send: (firstFrame: number, audio: ArrayBuffer) => void) {
  const buffer = new Uint8Array(frameBytes * FRAMES_PER_BATCH);
  let count = 0;
  let nextFrame = 0;
  function flush() {
    if (count) {
      send(nextFrame, buffer.slice(0, count * frameBytes).buffer);
      nextFrame += count;
      count = 0;
    }
    return nextFrame;
  }
  return {
    push(packet: ArrayBuffer) {
      const audio = new Uint8Array(packet).subarray(OPUS_HEADER_BYTES);
      if (audio.length !== frameBytes) throw new Error('Invalid radio frame');
      buffer.set(audio, count * frameBytes);
      if (++count === FRAMES_PER_BATCH) flush();
    },
    flush,
  };
}

function packetBytes(value: unknown) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return undefined;
}

export type PttSyncReply = { ok: boolean; finished?: boolean; nextFrame?: number; batch?: PttBatchPayload };

type Decoder = { frameBytes: number; frameSamples: number; sampleRate: number; decode(audio: Uint8Array): Float32Array; close(): void };
type ReceiveOptions = {
  hears(batch: PttBatchPayload): boolean;
  openDecoder(codec: PttOpusCodec): Decoder | Promise<Decoder>;
  sync(talkId: string, fromFrame: number): Promise<PttSyncReply>;
  play(batch: PttBatchPayload, samples: Float32Array, sampleRate: number): void;
  end(talkId: string): void;
};

export function createPttStreamReceiver(options: ReceiveOptions) {
  let disposed = false;
  let queue = Promise.resolve();
  let current: { id: string; nextFrame: number; decoder?: Decoder; codec: PttOpusCodec } | undefined;
  let gain = 1;
  let finishedId: string | undefined;
  let resume = false;

  function end() {
    const previous = current;
    if (!previous) return;
    current = undefined;
    finishedId = previous.id;
    previous.decoder?.close();
    if (previous.nextFrame > 0) options.end(previous.id);
  }

  function schedule(work: () => Promise<void>) {
    queue = queue.then(async () => { if (!disposed) await work(); }).catch(() => { end(); });
    return queue;
  }

  async function process(batch: PttBatchPayload, allowSkip = false) {
    const talk = current;
    if (!talk || talk.id !== batch.talkId || batch.codec !== talk.codec || !options.hears(batch)) return;
    const audio = packetBytes(batch.audio);
    if (!audio?.length) return;

    if (!talk.decoder) {
      const decoder = await options.openDecoder(talk.codec);
      if (disposed || current !== talk) { decoder.close(); return; }
      talk.decoder = decoder;
    }
    const { frameBytes, frameSamples, sampleRate } = talk.decoder;
    const count = audio.length / frameBytes;
    if (!Number.isInteger(count) || count < 1 || count > 410) return;
    if (batch.firstFrame > talk.nextFrame) {
      if (!allowSkip) return;
      talk.nextFrame = batch.firstFrame;
    }
    const skip = talk.nextFrame - batch.firstFrame;
    if (skip >= count) return;
    const samples = new Float32Array((count - skip) * frameSamples);
    for (let index = skip; index < count; index++) {
      samples.set(talk.decoder.decode(audio.subarray(index * frameBytes, (index + 1) * frameBytes)), (index - skip) * frameSamples);
    }
    talk.nextFrame = batch.firstFrame + count;
    let energy = 0;
    let peak = 0;
    for (const sample of samples) {
      energy += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(energy / samples.length);
    if (rms > 0.008) gain += (Math.max(1, Math.min(2.5, 0.12 / rms)) - gain) * 0.3;
    const outputGain = peak > 0 ? Math.min(gain, 0.95 / peak) : gain;
    for (let index = 0; index < samples.length; index++) samples[index] *= outputGain;
    options.play(batch, samples, sampleRate);
  }

  async function recover() {
    const talk = current;
    if (!talk) return undefined;
    const response = await options.sync(talk.id, talk.nextFrame).catch(() => ({ ok: false }) as PttSyncReply);
    if (disposed || current !== talk) return undefined;
    if (response.ok && response.batch) await process(response.batch, true);
    return response;
  }

  return {
    batch(batch: PttBatchPayload) {
      if (!batch || !options.hears(batch) || !Number.isSafeInteger(batch.firstFrame) || batch.firstFrame < 0
        || (batch.codec !== 'opus' && batch.codec !== 'opus-hq') || typeof batch.talkId !== 'string') return;
      void schedule(async () => {
        if (batch.talkId === finishedId) return;
        if (current?.id !== batch.talkId) {
          end();
          gain = 1;
          current = { id: batch.talkId, nextFrame: 0, codec: batch.codec };
        }
        const talk = current;
        // Audio returned by sync may overlap packets already queued by the socket.
        if (batch.firstFrame > talk.nextFrame) await recover();
        if (!disposed) await process(batch, true);
      });
    },
    free(payload: PttFreePayload) {
      void schedule(async () => {
        const talk = current;
        if (!talk || talk.id !== payload.talkId) return;
        if (typeof payload.frames === 'number' && payload.frames > talk.nextFrame) await recover();
        if (!disposed) end();
      });
    },
    disconnected() { resume = true; },
    joined() {
      if (!resume) return;
      resume = false;
      void schedule(async () => {
        const result = await recover();
        if (!disposed && (result?.finished || result?.ok === false)) end();
      });
    },
    dispose() {
      disposed = true;
      current?.decoder?.close();
      current = undefined;
    },
  };
}

export function pttAudioHistory(socket: { timeout(ms: number): { emitWithAck(event: string, body: unknown): Promise<PttSyncReply> } }) {
  return (talkId: string, fromFrame: number) => socket.timeout(2200).emitWithAck(PTT_EVENTS.AUDIO_SYNC, { talkId, fromFrame });
}
