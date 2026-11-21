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
const { createOpusEncoder, createOpusDecoder, opusHeader, opusFrames, FRAME_SAMPLES } = moduleWrapper.exports;
const talkId = '1bf119a1-5269-45d2-aec7-511b7b35e111';
const tone = (length) => Float32Array.from({ length }, (_, index) => 0.5 * Math.sin(index * 0.15));

test('actual libopus packets match the web gateway and carry partial and lookahead audio', () => {
  const packets = [];
  const encoder = createOpusEncoder(talkId, packet => packets.push(packet));
  const decoder = createOpusDecoder();
  try {
    encoder.push(tone(FRAME_SAMPLES));
    assert.deepEqual(packets.map(packet => packet.byteLength), [76]);
    encoder.push(tone(FRAME_SAMPLES + 120));
    assert.equal(packets.length, 1);
    encoder.flush();
    assert.deepEqual(packets.map(packet => packet.byteLength), [76, 136, 76]);
    const frames = packets.flatMap(packet => Array.from(opusFrames(packet, opusHeader(talkId))));
    assert.equal(frames.length, 4);
    for (const frame of frames) assert.equal(decoder.decode(frame).length, FRAME_SAMPLES);
    assert.equal(opusFrames(packets[0], opusHeader('11111111-1111-4111-8111-111111111111')).length, 0);
    assert.equal(opusFrames(packets[0].slice(0, 75), opusHeader(talkId)).length, 0);
  } finally {
    decoder.close();
    encoder.close();
  }
});
