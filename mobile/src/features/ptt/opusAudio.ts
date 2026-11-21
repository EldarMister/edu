import { Buffer } from 'buffer';
import type OpusScript from 'opusscript';

export const SPEECH_RATE = 16000;
export const FRAME_SAMPLES = 640;
export const FRAME_BYTES = FRAME_SAMPLES * 2;
export const CAPTURE_RATE = 24000;
export const CAPTURE_SAMPLES = 480;
const UUID_BYTES = 16;

const OPUS_PROFILES = {
  opus: { sampleRate: SPEECH_RATE, frameSamples: FRAME_SAMPLES, frameBytes: 60, bitrate: 12000, maxFramesPerPacket: 2 },
  'opus-hq': { sampleRate: CAPTURE_RATE, frameSamples: CAPTURE_SAMPLES, frameBytes: 80, bitrate: 32000, maxFramesPerPacket: 1 },
} as const;

export type OpusMode = keyof typeof OPUS_PROFILES;
export const PTT_CODEC_CAPABILITIES = ['opus-hq'] as const;

export function getOpusProfile(mode: OpusMode) {
  return OPUS_PROFILES[mode];
}

export function packetBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export function pcmFloats(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  return samples;
}

export function opusHeader(talkId: string): Uint8Array {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(talkId)) {
    throw new Error('Invalid radio transmission identifier');
  }
  return Buffer.from(talkId.replace(/-/g, ''), 'hex');
}

export function opusFrames(packet: unknown, header: Uint8Array, mode: OpusMode): Uint8Array[] {
  const { frameBytes, maxFramesPerPacket } = getOpusProfile(mode);
  const bytes = packetBytes(packet);
  const count = bytes ? (bytes.length - UUID_BYTES) / frameBytes : 0;
  if (!bytes || !Number.isInteger(count) || count < 1 || count > maxFramesPerPacket) return [];
  if (header.length !== UUID_BYTES || !header.every((byte, index) => byte === bytes[index])) return [];
  return Array.from({ length: count }, (_, index) => {
    const start = UUID_BYTES + index * frameBytes;
    return bytes.subarray(start, start + frameBytes);
  });
}

function createCodec(sampleRate: typeof SPEECH_RATE | typeof CAPTURE_RATE): OpusScript {
  // OpusScript uses the Node Buffer API for its output. The codec itself runs
  // offline in Hermes through its bundled asm.js libopus.
  if (typeof globalThis.Buffer === 'undefined') Object.assign(globalThis, { Buffer });
  const Codec = require('opusscript') as typeof OpusScript;
  return new Codec(sampleRate, 1, Codec.Application.VOIP, { wasm: false });
}

let preloaded = false;
export function prepareOpus() {
  if (preloaded) return;
  createCodec(CAPTURE_RATE).delete();
  preloaded = true;
}

export function createOpusEncoder(talkId: string, send: (packet: ArrayBuffer) => void, mode: OpusMode) {
  const { sampleRate, frameSamples, frameBytes, bitrate } = getOpusProfile(mode);
  const header = opusHeader(talkId);
  const codec = createCodec(sampleRate);
  codec.setBitrate(bitrate);
  codec.encoderCTL(4006, 0); // The wire format uses fixed-length frames.
  codec.encoderCTL(4024, 3001); // Voice signal, matching the PWA encoder.
  codec.encoderCTL(4016, 0); // DTX would change the frame length during silence.

  const pcm = Buffer.alloc(frameSamples * 2);
  let samplesWritten = 0;
  let hasSpeech = false;
  const resampling = sampleRate !== CAPTURE_RATE;
  // Keep up to two samples between microphone callbacks when converting 24 kHz to 16 kHz.
  const input = new Float32Array(3);
  let inputLength = 0;

  function encodeFrame() {
    const frame = codec.encode(pcm, frameSamples);
    if (frame.length !== frameBytes) throw new Error('Unexpected radio frame size');
    const packet = new Uint8Array(UUID_BYTES + frameBytes);
    packet.set(header);
    packet.set(frame, UUID_BYTES);
    samplesWritten = 0;
    send(packet.buffer);
  }

  function writeSample(sample: number) {
    const clipped = Math.max(-1, Math.min(1, sample));
    pcm.writeInt16LE(Math.round(clipped * (clipped < 0 ? 32768 : 32767)), samplesWritten * 2);
    samplesWritten++;
    if (samplesWritten === frameSamples) encodeFrame();
  }

  return {
    push(samples: Float32Array) {
      if (!samples.length) return;
      hasSpeech = true;
      if (!resampling) {
        for (const sample of samples) writeSample(sample);
        return;
      }
      for (const sample of samples) {
        input[inputLength++] = sample;
        if (inputLength !== 3) continue;
        // Average over the 1.5 input samples covered by each output sample.
        writeSample((2 * input[0] + input[1]) / 3);
        writeSample((input[1] + 2 * input[2]) / 3);
        inputLength = 0;
      }
    },
    flush() {
      if (!hasSpeech) return;
      if (inputLength) {
        writeSample(inputLength === 2 ? (2 * input[0] + input[1]) / 3 : input[0]);
        inputLength = 0;
      }
      if (samplesWritten > 0) {
        pcm.fill(0, samplesWritten * 2);
        encodeFrame();
      }
      // Drain the encoder lookahead so the receiver can hear the last word.
      pcm.fill(0);
      encodeFrame();
      hasSpeech = false;
    },
    close: () => codec.delete(),
  };
}

export function createOpusDecoder(mode: OpusMode) {
  const codec = createCodec(getOpusProfile(mode).sampleRate);
  return {
    decode: (frame: Uint8Array) => pcmFloats(codec.decode(Buffer.from(frame))),
    close: () => codec.delete(),
  };
}
