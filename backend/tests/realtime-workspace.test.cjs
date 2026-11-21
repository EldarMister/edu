require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventsGateway } = require('../src/realtime/events.gateway.ts');
const { getDefaultPermissionsByRole } = require('../src/common/permissions.ts');

test('socket rooms follow validated workspace and one batched refresh disconnects revoked access', async () => {
  const permissions = getDefaultPermissionsByRole('ADMIN');
  permissions.terminalAccess = true;
  const mixed = { id: 'mixed', role: 'ADMIN', name: 'Mixed', phone: '1', cafeId: 'cafe', isActive: true,
    positionId: 'position', prepStation: null, permissions: null, position: { role: 'ADMIN', permissions } };
  const owner = { ...mixed, id: 'owner', role: 'OWNER', position: null, positionId: null };
  const employees = new Map([[mixed.id, mixed], [owner.id, owner]]);
  const queries = [];
  const gateway = new EventsGateway({ verifyAsync: async (token) => ({ sub: token }) }, {
    cafe: { findUnique: async () => ({ status: 'active' }) },
    user: { findUnique: async ({ where }) => employees.get(where.id),
      findMany: async ({ where }) => { queries.push(where.id.in); return where.id.in.map((id) => employees.get(id)).filter(Boolean); } },
  });
  const makeSocket = (id, token, workspace) => ({ id, handshake: { auth: { token, workspace } }, data: {}, rooms: [], disconnected: false,
    join(room) { this.rooms.push(room); }, disconnect() { this.disconnected = true; } });
  const terminal = makeSocket('terminal-device', mixed.id, 'terminal');
  const admin = makeSocket('admin-device', mixed.id, 'admin');
  const ownerSocket = makeSocket('owner-device', owner.id, 'admin');
  const guest = makeSocket('guest');
  for (const client of [terminal, admin, ownerSocket, guest]) await gateway.handleConnection(client);
  gateway.server = { sockets: { sockets: new Map([terminal, admin, ownerSocket, guest].map((client) => [client.id, client])) } };
  assert.ok(terminal.rooms.includes('cafe:cafe:waiters'));
  assert.ok(!terminal.rooms.includes('cafe:cafe:management'));
  assert.ok(admin.rooms.includes('cafe:cafe:management'));
  assert.equal(terminal.data.user.identityRole, 'ADMIN');
  assert.equal(terminal.data.user.role, 'WAITER');
  await gateway.revalidateStaffConnections();
  assert.deepEqual(queries, [['mixed', 'owner']], 'two devices for one employee share a single lookup');
  assert.ok([terminal, admin, ownerSocket, guest].every((client) => !client.disconnected));
  permissions.readOnlySections = ['staff'];
  await gateway.revalidateStaffConnections();
  assert.equal(admin.disconnected, true, 'changed administrative permissions leave management rooms');
  assert.equal(terminal.disconnected, false, 'unrelated administration rights do not change the terminal projection');
  permissions.terminalAccess = false;
  owner.isActive = false;
  await gateway.revalidateStaffConnections();
  assert.equal(terminal.disconnected, true);
  assert.equal(ownerSocket.disconnected, true);
  assert.equal(guest.disconnected, false);
  const forged = makeSocket('forged', mixed.id, 'terminal');
  await gateway.handleConnection(forged);
  assert.equal(forged.disconnected, true, 'reconnecting cannot restore a revoked workspace');
  gateway.onModuleDestroy();
});

test('live radio relays only valid frames from the current talker inside the same cafe', async () => {
  const { PttGateway } = require('../src/realtime/ptt.gateway.ts');
  const gateway = new PttGateway({}, {});
  const notifications = [];
  const frames = [];
  gateway.server = { to: (rooms) => ({ emit: (event, payload) => notifications.push({ rooms, event, payload }) }) };
  function socket(id, cafeId) {
    return {
      id, connected: true,
      data: { user: { id, cafeId, role: 'WAITER' }, pttChannel: 'waiters' },
      emit() {},
      to: (rooms) => ({ emit: (event, payload) => frames.push({ rooms, event, payload }) }),
    };
  }
  const first = socket('sender', 'a');
  const other = socket('listener', 'a');
  const foreign = socket('foreign', 'b');
  const channel = 'waiters';
  const talkId = '75d0a019-a195-450b-89e4-766c7de92ea5';
  const frame = { channel, talkId, audio: Buffer.alloc(1280, 42) };
  try {
    assert.equal((await gateway.handleStartTalk(first, { channel, talkId })).talkId, talkId);
    assert.equal((await gateway.handleStartTalk(other, { channel, talkId })).reason, 'busy');
    gateway.handleAudioFrame(other, frame);
    gateway.handleAudioFrame(foreign, frame);
    gateway.handleAudioFrame(first, { ...frame, audio: 'not binary' });
    gateway.handleAudioFrame(first, { ...frame, audio: Buffer.alloc(1282) });
    gateway.handleAudioFrame(first, { ...frame, talkId: 'previous-talk' });
    assert.equal(frames.length, 0);

    await gateway.handleStopTalk(first, { channel, talkId: 'previous-talk' });
    gateway.handleAudioFrame(first, frame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].rooms, 'restaurant_a_waiters');
    assert.equal(frames[0].event, 'ptt_audio_frame');
    assert.equal(frames[0].payload.audio, frame.audio);
    assert.equal(frames[0].payload.senderId, first.id);
    assert.equal(notifications.some(({ event }) => event === 'ptt_channel_free'), false);

    for (let index = 0; index < 24; index++) gateway.handleAudioFrame(first, frame);
    assert.equal(frames.length, 25);
    await gateway.handleStopTalk(first, { channel, talkId });
    gateway.handleAudioFrame(first, frame);
    assert.equal(frames.length, 25);
    assert.equal(notifications.at(-1).payload.talkId, talkId);

    first.data.pttChannel = 'general';
    await gateway.handleStartTalk(first, { channel: 'general', talkId });
    gateway.handleAudioFrame(first, { ...frame, channel: 'general' });
    assert.deepEqual(frames.at(-1).rooms, [
      'restaurant_a_general', 'restaurant_a_waiters', 'restaurant_a_kitchen', 'restaurant_a_admin',
    ]);
    await gateway.handleStopTalk(first, { channel: 'general', talkId });
  } finally {
    await gateway.handleStopTalk(first, { channel: first.data.pttChannel, talkId });
  }
});

test('compact Opus packets retain their talk and room identity, including for a late listener', async () => {
  const { PttGateway } = require('../src/realtime/ptt.gateway.ts');
  const gateway = new PttGateway({}, {});
  const relayed = [];
  const received = [];
  const talkId = 'c6a5d98e-7a46-4926-9442-3b54c384ff0f';
  const packet = Buffer.alloc(136);
  Buffer.from(talkId.replaceAll('-', ''), 'hex').copy(packet);
  gateway.server = { to: () => ({ emit() {} }), in: () => ({ async fetchSockets() { return []; } }) };
  const socket = (id, cafeId) => ({
    id, connected: true, data: { user: { id, cafeId, role: 'WAITER' }, pttChannel: 'waiters' },
    join() {}, leave() {},
    emit(event, body) { received.push({ id, event, body }); },
    to: (room) => ({ emit: (event, body) => relayed.push({ room, event, body }) }),
  });
  const sender = socket('talker', 'a');
  try {
    assert.equal((await gateway.handleStartTalk(sender, { channel: 'waiters', talkId, codec: 'opus' })).codec, 'opus');
    const listener = socket('listener', 'a');
    await gateway.handleJoin(listener, { channel: 'waiters' });
    const busy = received.find(({ event, id }) => event === 'ptt_channel_busy' && id === listener.id);
    assert.equal(busy.body.talkId, talkId);
    assert.equal(busy.body.codec, 'opus');

    gateway.handleAudioPacket(socket('outsider', 'b'), packet);
    gateway.handleAudioPacket(listener, packet);
    gateway.handleAudioPacket(sender, Buffer.alloc(136));
    gateway.handleAudioPacket(sender, packet.subarray(0, 135));
    assert.equal(relayed.length, 0);
    gateway.handleAudioPacket(sender, packet);
    assert.deepEqual(relayed, [{ room: 'restaurant_a_waiters', event: 'ptt_audio_packet', body: packet }]);
    await gateway.handleStopTalk(sender, { channel: 'waiters', talkId });
    gateway.handleAudioPacket(sender, packet);
    assert.equal(relayed.length, 1);
  } finally {
    await gateway.handleStopTalk(sender, { channel: 'waiters', talkId });
  }
});

test('higher-quality radio negotiates across all audible rooms and preserves legacy listeners', async (t) => {
  const { PttGateway } = require('../src/realtime/ptt.gateway.ts');
  const gateway = new PttGateway({}, {});
  const clients = [];
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const members = (rooms) => clients.filter((client) => [rooms].flat().some((room) => client.rooms.has(room)));
  const broadcast = (rooms, excluded) => ({
    emit(event, payload) {
      for (const member of members(rooms)) if (member !== excluded) member.emit(event, payload);
    },
  });
  gateway.server = {
    to: broadcast,
    in: (rooms) => ({ fetchSockets: async () => members(rooms) }),
  };
  async function connect(id, cafeId, channel, supportsHq) {
    const client = {
      id, connected: true, data: { user: { id, cafeId, role: 'WAITER' } }, rooms: new Set(), events: [],
      join(rooms) { [rooms].flat().forEach((room) => this.rooms.add(room)); },
      leave(room) { this.rooms.delete(room); },
      emit(event, payload) { this.events.push({ event, payload }); },
      to(rooms) { return broadcast(rooms, this); },
    };
    clients.push(client);
    await gateway.handleJoin(client, supportsHq ? { channel, codecs: ['opus-hq'] } : { channel });
    return client;
  }
  const countPackets = (client) => client.events.filter(({ event }) => event === 'ptt_audio_packet').length;
  const sender = await connect('sender', 'a', 'general', true);
  const listener = await connect('listener', 'a', 'kitchen', true);
  const outsider = await connect('outsider', 'b', 'kitchen', false);
  const talkId = 'a75369e4-383d-46f1-aa39-4186969096c8';
  const request = { channel: 'general', talkId, codec: 'opus', preferHq: true };
  const packet = (size) => {
    const bytes = Buffer.alloc(size);
    Buffer.from(talkId.replaceAll('-', ''), 'hex').copy(bytes);
    return bytes;
  };
  try {
    assert.equal((await gateway.handleStartTalk(sender, request)).codec, 'opus-hq');
    assert.equal(listener.events.find(({ event }) => event === 'ptt_channel_busy').payload.codec, 'opus-hq');
    const lateLegacy = await connect('older-device', 'a', 'admin', false);
    const lateHq = await connect('new-device', 'a', 'waiters', true);
    assert.equal(lateHq.events.find(({ event }) => event === 'ptt_channel_busy').payload.codec, 'opus-hq');
    assert.equal((await gateway.handleStartTalk(sender, request)).codec, 'opus-hq', 'a retry keeps its granted codec');

    const hqFrame = packet(96);
    gateway.handleAudioPacket(sender, packet(136));
    gateway.handleAudioPacket(sender, packet(176));
    gateway.handleAudioPacket(sender, Buffer.alloc(96));
    gateway.handleAudioPacket(listener, hqFrame);
    assert.equal(countPackets(listener), 0);
    for (let i = 0; i < 180; i++) gateway.handleAudioPacket(sender, hqFrame);
    for (let i = 0; i < 500; i++) {
      now += 20;
      gateway.handleAudioPacket(sender, hqFrame);
    }
    assert.equal(countPackets(listener), 680, 'supports a delayed burst followed by 50 frames per second');
    assert.equal(countPackets(lateHq), 680);
    assert.equal(countPackets(lateLegacy), 0);
    assert.equal(countPackets(sender), 0);
    assert.equal(countPackets(outsider), 0);

    await gateway.handleStopTalk(sender, request);
    assert.equal((await gateway.handleStartTalk(sender, request)).codec, 'opus');
    gateway.handleAudioPacket(sender, hqFrame);
    gateway.handleAudioPacket(sender, packet(76));
    assert.equal(countPackets(listener), 681);
    assert.equal(countPackets(lateLegacy), 1, 'the next talk uses a codec the late listener can hear');

    await gateway.handleStopTalk(sender, request);
    await gateway.handleJoin(lateLegacy, { channel: null });
    assert.equal((await gateway.handleStartTalk(sender, { ...request, preferHq: false })).codec, 'opus');
  } finally {
    await gateway.handleStopTalk(sender, request);
  }
});
