import type { PttOpusCodec } from './types';

export const PTT_CAPTURE_RATE = 24_000;
const CAPTURE_SAMPLES = 480;
const CAPTURE_BYTES = CAPTURE_SAMPLES * 2;
const TALK_ID_BYTES = 16;

export const PTT_OPUS_PROFILES = {
  opus: { sampleRate: 16_000, frameSamples: 640, bitrate: 12_000, frameBytes: 60, maxFramesPerPacket: 2 },
  'opus-hq': { sampleRate: PTT_CAPTURE_RATE, frameSamples: CAPTURE_SAMPLES, bitrate: 32_000, frameBytes: 80, maxFramesPerPacket: 1 },
} as const;

export function isPttOpusCodec(value: unknown): value is PttOpusCodec {
  return value === 'opus' || value === 'opus-hq';
}

export async function preparePttOpus() {
  const { loadLibopus } = await import('libopus-wasm');
  await loadLibopus();
}

export function pttOpusHeader(talkId: string) {
  const hex = talkId.replaceAll('-', '');
  return Uint8Array.from({ length: TALK_ID_BYTES }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

export async function createPttOpusEncoder(talkId: string, send: (packet: ArrayBuffer) => void, codec: PttOpusCodec) {
  const profile = PTT_OPUS_PROFILES[codec];
  const { Application, Signal, createEncoder } = await import('libopus-wasm');
  const encoder = await createEncoder({
    sampleRate: profile.sampleRate, channels: 1, frameSize: profile.frameSamples, application: Application.Voip,
    bitrate: profile.bitrate, signal: Signal.Voice, vbr: false, dtx: false,
  });
  const header = pttOpusHeader(talkId);
  const pendingPcm = new ArrayBuffer(profile.frameSamples * 2);
  const pending = new DataView(pendingPcm);
  let pendingSamples = 0;
  let sent = false;

  function transmit(pcm: ArrayBuffer) {
    const frame = encoder.encode(new Uint8Array(pcm));
    if (frame.length !== profile.frameBytes) throw new Error('Unexpected PTT Opus packet length');
    const packet = new Uint8Array(TALK_ID_BYTES + frame.length);
    packet.set(header);
    packet.set(frame, TALK_ID_BYTES);
    send(packet.buffer);
    sent = true;
  }

  function push(pcm: ArrayBuffer) {
    if (pcm.byteLength !== CAPTURE_BYTES) throw new Error('Unexpected PTT capture frame length');
    if (codec === 'opus-hq') {
      transmit(pcm);
      return;
    }

    // Each group of three 24 kHz samples covers two 16 kHz samples.
    const input = new DataView(pcm);
    for (let offset = 0; offset < CAPTURE_BYTES; offset += 6) {
      const left = input.getInt16(offset, true);
      const middle = input.getInt16(offset + 2, true);
      const right = input.getInt16(offset + 4, true);
      pending.setInt16(pendingSamples++ * 2, Math.round((2 * left + middle) / 3), true);
      pending.setInt16(pendingSamples++ * 2, Math.round((middle + 2 * right) / 3), true);
    }
    if (pendingSamples === profile.frameSamples) {
      transmit(pendingPcm);
      pendingSamples = 0;
    }
  }

  return {
    push,
    flush() {
      if (pendingSamples > 0) {
        new Uint8Array(pendingPcm).fill(0, pendingSamples * 2);
        transmit(pendingPcm);
        pendingSamples = 0;
      }
      // Give the encoder's look-ahead enough input to emit the end of the phrase.
      if (sent) transmit(new ArrayBuffer(profile.frameSamples * 2));
    },
    close() { encoder.free(); },
  };
}

export async function createPttOpusDecoder(codec: PttOpusCodec) {
  const profile = PTT_OPUS_PROFILES[codec];
  const { createDecoder } = await import('libopus-wasm');
  return createDecoder({ sampleRate: profile.sampleRate, channels: 1, maxFrameSize: profile.frameSamples });
}

export function pttOpusFrames(packet: unknown, header: Uint8Array, codec: PttOpusCodec) {
  const bytes = packet instanceof ArrayBuffer
    ? new Uint8Array(packet)
    : ArrayBuffer.isView(packet) ? new Uint8Array(packet.buffer, packet.byteOffset, packet.byteLength) : undefined;
  if (!bytes || header.length !== TALK_ID_BYTES) return [];
  const { frameBytes, maxFramesPerPacket } = PTT_OPUS_PROFILES[codec];
  const count = (bytes.length - TALK_ID_BYTES) / frameBytes;
  if (!Number.isInteger(count) || count < 1 || count > maxFramesPerPacket
    || !header.every((byte, index) => bytes[index] === byte)) return [];
  return Array.from({ length: count }, (_, index) => {
    const offset = TALK_ID_BYTES + index * frameBytes;
    return bytes.subarray(offset, offset + frameBytes);
  });
}
