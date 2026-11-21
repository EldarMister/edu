const SAMPLE_RATE = 16_000;
const PCM_SAMPLES = 640;
const OPUS_BYTES = 60; // 40 ms at 12 kbit/s in CBR mode
const TALK_ID_BYTES = 16;

export async function preparePttOpus() {
  const { loadLibopus } = await import('libopus-wasm');
  await loadLibopus();
}

export function pttOpusHeader(talkId: string) {
  const hex = talkId.replaceAll('-', '');
  return Uint8Array.from({ length: TALK_ID_BYTES }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

export async function createPttOpusEncoder(talkId: string, send: (packet: ArrayBuffer) => void) {
  const { Application, Signal, createEncoder } = await import('libopus-wasm');
  const encoder = await createEncoder({
    sampleRate: SAMPLE_RATE, channels: 1, frameSize: PCM_SAMPLES, application: Application.Voip,
    bitrate: 12_000, signal: Signal.Voice, vbr: false, dtx: false,
  });
  const header = pttOpusHeader(talkId);
  let pending: Uint8Array | undefined;
  let first = true;

  function transmit(one: Uint8Array, two?: Uint8Array) {
    const packet = new Uint8Array(TALK_ID_BYTES + one.length + (two?.length ?? 0));
    packet.set(header);
    packet.set(one, TALK_ID_BYTES);
    if (two) packet.set(two, TALK_ID_BYTES + one.length);
    send(packet.buffer);
  }

  function push(pcm: ArrayBuffer) {
    const frame = encoder.encode(new Uint8Array(pcm));
    if (frame.length !== OPUS_BYTES) throw new Error('Unexpected PTT Opus packet length');
    if (first) {
      first = false;
      transmit(frame);
    } else if (pending) {
      transmit(pending, frame);
      pending = undefined;
    } else {
      pending = frame;
    }
  }

  return {
    push,
    flush() {
      if (first) return;
      // Send one padding frame so the encoder's look-ahead retains the very end of the phrase.
      push(new ArrayBuffer(PCM_SAMPLES * 2));
      if (pending) transmit(pending);
      pending = undefined;
    },
    close() { encoder.free(); },
  };
}

export async function createPttOpusDecoder() {
  const { createDecoder } = await import('libopus-wasm');
  return createDecoder({ sampleRate: SAMPLE_RATE, channels: 1, maxFrameSize: PCM_SAMPLES });
}

export function pttOpusFrames(packet: unknown, header: Uint8Array) {
  if (!(packet instanceof ArrayBuffer)) return [];
  const bytes = new Uint8Array(packet);
  const count = (bytes.length - TALK_ID_BYTES) / OPUS_BYTES;
  if ((count !== 1 && count !== 2) || !header.every((byte, index) => bytes[index] === byte)) return [];
  return Array.from({ length: count }, (_, index) => {
    const offset = TALK_ID_BYTES + index * OPUS_BYTES;
    return bytes.subarray(offset, offset + OPUS_BYTES);
  });
}
