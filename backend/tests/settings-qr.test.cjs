require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const test = require('node:test');
const { SettingsService } = require('../src/settings/settings.service.ts');
const { SettingsController } = require('../src/settings/settings.controller.ts');
const { runWithTenant, getCafeId } = require('../src/tenant/tenant-context.ts');

const qrData = (text, mime = 'png') => `data:image/${mime};base64,${Buffer.from(text).toString('base64')}`;

function fixture() {
  const rows = [
    { id: 'settings-a', cafeId: 'cafe-a', cafeName: 'Cafe A', qrImageUrl: qrData('bank-a'), updatedAt: new Date('2026-10-10T10:00:00Z'), payQr: true, payCash: true, payCard: false },
    { id: 'settings-b', cafeId: 'cafe-b', cafeName: 'Cafe B', qrImageUrl: qrData('bank-b', 'jpeg'), updatedAt: new Date('2026-10-10T11:00:00Z'), payQr: true, payCash: true, payCard: false },
  ];
  const calls = { created: 0, first: 0, unique: [] };
  const prisma = { settings: {
    findFirst: async () => { calls.first++; return rows.find(row => !getCafeId() || row.cafeId === getCafeId()) ?? null; },
    findUnique: async ({ where }) => { calls.unique.push(where); return rows.find(row => row.id === where.id) ?? null; },
    create: async () => { calls.created++; throw new Error('Public QR request must not create settings'); },
    update: async ({ where, data }) => {
      const row = rows.find(row => row.id === where.id);
      Object.assign(row, data, { updatedAt: new Date(row.updatedAt.getTime() + 1_000) });
      return { ...row };
    },
  } };
  return { rows, calls, service: new SettingsService(prisma, { log: async () => {} }, { emitBroadcast: () => {} }) };
}

test('payment QR URLs and public image lookup target the exact cafe with no JWT', async () => {
  const { service, calls } = fixture();
  const a = await runWithTenant({ cafeId: 'cafe-a' }, () => service.getPublic());
  const b = await runWithTenant({ cafeId: 'cafe-b' }, () => service.getPublic());
  const refA = new URL(a.qrImageUrl, 'https://example.test').searchParams.get('ref');
  const refB = new URL(b.qrImageUrl, 'https://example.test').searchParams.get('ref');
  assert.notEqual(refA, refB);
  const imgA = await runWithTenant({}, () => service.getQrImage(refA));
  const imgB = await runWithTenant({}, () => service.getQrImage(refB));
  assert.equal(imgA.buffer.toString(), 'bank-a');
  assert.equal(imgA.mime, 'image/png');
  assert.equal(imgB.buffer.toString(), 'bank-b');
  assert.equal(imgB.mime, 'image/jpeg');
  assert.equal(calls.first, 2, 'Image lookup must not fall back to unscoped ensure()');
  assert.equal(calls.created, 0);
});

test('missing, malformed and unknown image refs never return the first cafe QR', async () => {
  const { service, calls } = fixture();
  for (const ref of [undefined, '', ' ', ['settings-a'], 'unknown']) {
    assert.equal(await service.getQrImage(ref), null);
  }
  assert.equal(calls.first, 0);
  assert.equal(calls.created, 0);
});

test('upload, replacement and removal keep payment QR data scoped and versioned', async () => {
  const { service } = fixture();
  const actor = { id: 'owner-b', role: 'OWNER', name: 'Owner B' };
  const before = await runWithTenant({ cafeId: 'cafe-b' }, () => service.getPublic());
  await runWithTenant({ cafeId: 'cafe-b' }, () => service.update({ qrImageUrl: qrData('new-bank-b', 'webp') }, actor));
  const after = await runWithTenant({ cafeId: 'cafe-b' }, () => service.getPublic());
  assert.notEqual(after.qrImageUrl, before.qrImageUrl);
  assert.equal((await service.getQrImage('settings-b')).buffer.toString(), 'new-bank-b');
  assert.equal((await service.getQrImage('settings-a')).buffer.toString(), 'bank-a');
  await runWithTenant({ cafeId: 'cafe-b' }, () => service.update({ qrImageUrl: '' }, actor));
  assert.equal((await runWithTenant({ cafeId: 'cafe-b' }, () => service.getPublic())).qrImageUrl, null);
  assert.equal(await service.getQrImage('settings-b'), null);
  assert.equal((await service.getQrImage('settings-a')).buffer.toString(), 'bank-a');
});

test('public QR controller forwards ref and uses 404 for missing images', async () => {
  const { service } = fixture();
  const controller = new SettingsController(service);
  const calls = { headers: {} };
  const response = {
    status: code => { calls.status = code; return response; },
    setHeader: (key, value) => { calls.headers[key] = value; },
    end: body => { calls.body = body; },
  };
  await controller.qrImage(response, 'settings-b');
  assert.equal(calls.headers['Content-Type'], 'image/jpeg');
  assert.equal(calls.body.toString(), 'bank-b');
  await controller.qrImage(response);
  assert.equal(calls.status, 404);
  assert.equal(calls.body, undefined);
});
