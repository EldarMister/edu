const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const receiver = resolve(__dirname, '../../../src/features/ptt/useAudioPttReceiver.ts');
const code = ts.transpileModule(readFileSync(receiver, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const ticks = () => new Promise((done) => setImmediate(done));

function app(withNative = true) {
  const events = [], state = {};
  const native = { begin: (id) => events.push(['begin', id]), stop: (id) => events.push(['stop', id]),
    enqueue: async (id, value) => { events.push(['pcm', id, value]); if (state.holdNative) return new Promise(() => {}); return value !== 'unsupported'; },
    remaining: () => state.buffered ?? 0 };
  const sound = { setOnPlaybackStatusUpdate: (fn) => { state.onStatus = fn; },
    playAsync: async () => { events.push(['play']); }, unloadAsync: async () => { events.push(['unload']); } };
  const stub = {
    react: { useState: () => [false, (flag) => { state.receiving = flag; }], useEffect: (fn) => { state.cleanup = fn(); } },
    'react-native': { AppState: { currentState: 'active', addEventListener: (_, fn) => {
      state.visible = fn; return { remove: () => {} };
    } } },
    expo: { requireOptionalNativeModule: () => withNative ? native : null },
    'expo-av': { Audio: { setAudioModeAsync: async () => {}, Sound: { createAsync: async () =>
      ({ sound, status: { isLoaded: true, durationMillis: 50 } }) } } },
    'expo-file-system': { EncodingType: { Base64: 'base64' }, cacheDirectory: '/cache/',
      writeAsStringAsync: async (_, value) => { events.push(['file', value]); }, deleteAsync: async () => { events.push(['delete']); } },
    '@/services/socket': { getSocket: () => ({ on: (_, fn) => { state.receive = fn; }, off: () => {} }) },
    '@/store/auth': { useAuth: (pick) => pick({ user: { id: 'self' } }) },
    './types': { PTT_EVENTS: { AUDIO_STREAM: 'audio' } },
  };
  const exports = {};
  new Function('exports', 'require', code)(exports, (path) => stub[path]);
  return { events, state, mount: (channel) => exports.useAudioPttReceiver(channel, true),
    send: (chunk, mimeType = 'audio/wav', senderId = 'other', channel = 'kitchen') =>
      state.receive({ chunk, mimeType, senderId, channel }) };
}

test('successive PCM packets reuse the streaming player until actual playback drains', async () => {
  const radio = app();
  radio.mount('kitchen');
  radio.state.buffered = 15;
  for (const packet of ['a', 'b', 'c']) radio.send(packet);
  radio.send('own', 'audio/wav', 'self');
  radio.send('unsubscribed', 'audio/wav', 'other', 'waiters');
  await ticks();
  assert.deepEqual(radio.events.map(([name]) => name), ['begin', 'pcm', 'pcm', 'pcm']);
  assert.deepEqual(radio.events.slice(1).map(([, , packet]) => packet), ['a', 'b', 'c']);
  assert.equal(radio.state.receiving, true);
  radio.state.buffered = 0;
  await new Promise((done) => setTimeout(done, 35));
  assert.equal(radio.state.receiving, false);
  radio.state.visible('background');
  radio.state.visible('active');
  radio.send('resumed');
  await ticks();
  assert.deepEqual(radio.events.slice(-3).map(([name]) => name), ['stop', 'begin', 'pcm']);
  assert.notEqual(radio.events[0][1], radio.events.at(-1)[1]);
  radio.state.cleanup();
  assert.equal(radio.events.at(-1)[0], 'stop');
});

test('unknown WAV and legacy AAC use the file player, and a channel switch cancels queued audio', async () => {
  const radio = app();
  radio.mount('kitchen');
  radio.send('unsupported');
  radio.send('later');
  await ticks();
  assert.deepEqual(radio.events.map(([name]) => name), ['begin', 'pcm', 'stop', 'file', 'play']);
  radio.state.cleanup();
  radio.mount('waiters');
  await ticks();
  assert.deepEqual(radio.events.slice(-2), [['unload'], ['delete']]);
  assert.equal(radio.events.some((event) => event.includes('later')), false);
  radio.send('aac', 'audio/mp4', 'other', 'general');
  await ticks();
  assert.deepEqual(radio.events.slice(-2), [['file', 'aac'], ['play']]);
  radio.state.onStatus({ isLoaded: true, didJustFinish: true });
  await ticks();
  radio.state.cleanup();
});

test('legacy binary without the optional module plays WAV and mutes when backgrounded', async () => {
  const radio = app(false);
  radio.mount('kitchen');
  radio.send('wav');
  await ticks();
  assert.deepEqual(radio.events, [['file', 'wav'], ['play']]);
  radio.state.visible('background');
  radio.send('background');
  await ticks();
  assert.deepEqual(radio.events.slice(-2), [['unload'], ['delete']]);
  assert.equal(radio.state.receiving, false);
  radio.state.cleanup();
});

test('a stalled playback head, enqueue, or missing file-finished event releases push-to-talk for the next turn', async () => {
  await Promise.all(['head', 'enqueue', 'file'].map(async (failure) => {
    const radio = app();
    radio.mount('kitchen');
    radio.state.buffered = failure === 'head' ? 80 : 0;
    radio.state.holdNative = failure === 'enqueue';
    radio.send('first', failure === 'file' ? 'audio/mp4' : 'audio/wav');
    await ticks();
    assert.equal(radio.state.receiving, true, failure);
    await new Promise((done) => setTimeout(done, 1800));
    assert.equal(radio.state.receiving, false, failure);
    radio.state.buffered = 0;
    radio.state.holdNative = false;
    radio.send('next');
    await ticks();
    assert.equal(radio.events.some((event) => event[0] === 'pcm' && event[2] === 'next'), true, failure);
    assert.equal(radio.state.receiving, false, failure);
    radio.state.cleanup();
  }));
});
