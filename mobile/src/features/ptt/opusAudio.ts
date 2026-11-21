import { Buffer } from 'buffer';
import type OpusScript from 'opusscript';

export const SPEECH_RATE = 16000;
export const FRAME_SAMPLES = 640;
export const FRAME_BYTES = FRAME_SAMPLES * 2;
const OPUS_FRAME_BYTES = 60;
const UUID_BYTES = 16;

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

export function opusFrames(packet: unknown, header: Uint8Array): Uint8Array[] {
  const bytes = packetBytes(packet);
  const count = bytes ? (bytes.length - UUID_BYTES) / OPUS_FRAME_BYTES : 0;
  if (!bytes || (count !== 1 && count !== 2)) return [];
  if (header.length !== UUID_BYTES || !header.every((byte, index) => byte === bytes[index])) return [];
  return Array.from({ length: count }, (_, index) => {
    const start = UUID_BYTES + index * OPUS_FRAME_BYTES;
    return bytes.subarray(start, start + OPUS_FRAME_BYTES);
  });
}

function createCodec(): OpusScript {
  // OpusScript uses the Node Buffer API for its output. The codec itself runs
  // offline in Hermes through its bundled asm.js libopus.
  if (typeof globalThis.Buffer === 'undefined') Object.assign(globalThis, { Buffer });
  const Codec = require('opusscript') as typeof OpusScript;
  return new Codec(SPEECH_RATE, 1, Codec.Application.VOIP, { wasm: false });
}

let preloaded = false;
export function prepareOpus() {
  if (preloaded) return;
  createCodec().delete();
  preloaded = true;
}

export function createOpusEncoder(talkId: string, send: (packet: ArrayBuffer) => void) {
  const header = opusHeader(talkId);
  const codec = createCodec();
  codec.setBitrate(12000);
  codec.encoderCTL(4006, 0); // Constant bitrate: every 40 ms frame is 60 bytes.
  codec.encoderCTL(4024, 3001); // Voice signal, matching the PWA encoder.
  codec.encoderCTL(4016, 0); // DTX would change the frame length during silence.

  const pcm = Buffer.alloc(FRAME_BYTES);
  let samplesWritten = 0;
  let encoded: Uint8Array[] = [];
  let sentPacket = false;
  let hasSpeech = false;

  function sendPacket() {
    if (!encoded.length) return;
    const packet = new Uint8Array(UUID_BYTES + encoded.length * OPUS_FRAME_BYTES);
    packet.set(header);
    encoded.forEach((frame, index) => packet.set(frame, UUID_BYTES + index * OPUS_FRAME_BYTES));
    encoded = [];
    sentPacket = true;
    send(packet.buffer);
  }

  function encodeFrame() {
    const frame = codec.encode(pcm, FRAME_SAMPLES);
    if (frame.length !== OPUS_FRAME_BYTES) throw new Error('Unexpected radio frame size');
    encoded.push(frame);
    samplesWritten = 0;
    if (!sentPacket || encoded.length === 2) sendPacket();
  }

  return {
    push(samples: Float32Array) {
      for (const sample of samples) {
        const clipped = Math.max(-1, Math.min(1, sample));
        pcm.writeInt16LE(Math.round(clipped * (clipped < 0 ? 32768 : 32767)), samplesWritten * 2);
        samplesWritten++;
        hasSpeech = true;
        if (samplesWritten === FRAME_SAMPLES) encodeFrame();
      }
    },
    flush() {
      if (!hasSpeech) return;
      if (samplesWritten > 0) {
        pcm.fill(0, samplesWritten * 2);
        encodeFrame();
      }
      // Drain the encoder lookahead so the receiver can hear the last word.
      pcm.fill(0);
      encodeFrame();
      sendPacket();
    },
    close: () => codec.delete(),
  };
}

export function createOpusDecoder() {
  const codec = createCodec();
  return {
    decode: (frame: Uint8Array) => pcmFloats(codec.decode(Buffer.from(frame))),
    close: () => codec.delete(),
  };
}
