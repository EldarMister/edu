const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/ptt/opusAudio.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleWrapper = { exports: {} };
vm.runInNewContext(source, {
  module: moduleWrapper, exports: moduleWrapper.exports, require, ArrayBuffer, DataView, Uint8Array, Float32Array,
});
const { createOpusEncoder, createOpusDecoder, opusHeader, opusFrames, getOpusProfile, CAPTURE_SAMPLES } = moduleWrapper.exports;
const talkId = '1bf119a1-5269-45d2-aec7-511b7b35e111';
const tone = (length) => Float32Array.from({ length }, (_, index) => 0.5 * Math.sin(index * 0.15));

for (const [mode, packetSize, captureFramesPerPacket] of [['opus', 76, 2], ['opus-hq', 96, 1]]) {
  test(`libopus emits ${mode} frames immediately and preserves a split tail`, () => {
    const packets = [];
    const encoder = createOpusEncoder(talkId, packet => packets.push(packet), mode);
    const decoder = createOpusDecoder(mode);
    const header = opusHeader(talkId);
    try {
      for (let index = 0; index < captureFramesPerPacket - 1; index++) encoder.push(tone(CAPTURE_SAMPLES));
      assert.equal(packets.length, 0);
      encoder.push(tone(CAPTURE_SAMPLES));
      assert.deepEqual(packets.map(packet => packet.byteLength), [packetSize]);
      encoder.push(tone(10));
      encoder.push(tone(101));
      encoder.flush();
      encoder.flush();
      assert.deepEqual(packets.map(packet => packet.byteLength), [packetSize, packetSize, packetSize]);
      const frames = packets.flatMap(packet => Array.from(opusFrames(packet, header, mode)));
      assert.equal(frames.length, 3);
      const decoded = decoder.decode(frames[0]);
      assert.equal(decoded.length, getOpusProfile(mode).frameSamples);
      assert.ok(decoded.some(sample => Math.abs(sample) > 0.1));
      assert.equal(decoder.decode(frames[1]).length, decoded.length);
      assert.equal(decoder.decode(frames[2]).length, decoded.length);
      assert.equal(opusFrames(packets[0], opusHeader('11111111-1111-4111-8111-111111111111'), mode).length, 0);
      assert.equal(opusFrames(packets[0].slice(0, packetSize - 1), header, mode).length, 0);
      assert.equal(opusFrames(packets[0], header, mode === 'opus' ? 'opus-hq' : 'opus').length, 0);
      const combined = new Uint8Array(2 * packetSize - header.length);
      combined.set(new Uint8Array(packets[0]));
      combined.set(new Uint8Array(packets[1]).subarray(header.length), packetSize);
      assert.equal(opusFrames(combined, header, mode).length, mode === 'opus' ? 2 : 0);
    } finally {
      decoder.close();
      encoder.close();
    }
  });
}

test('legacy resampling is independent of how microphone callbacks are split', () => {
  const samples = tone(2 * CAPTURE_SAMPLES + 11);
  function encode(chunks) {
    const packets = [];
    const encoder = createOpusEncoder(talkId, packet => packets.push(Buffer.from(packet)), 'opus');
    try {
      for (const chunk of chunks) encoder.push(chunk);
      encoder.flush();
    } finally {
      encoder.close();
    }
    return packets;
  }
  assert.deepEqual(encode([samples]), encode([samples.subarray(0, 479), samples.subarray(479, 960), samples.subarray(960)]));
});
