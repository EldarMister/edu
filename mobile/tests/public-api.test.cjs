const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require: name => { if (!(name in modules)) throw new Error(`Unexpected import ${name}`); return modules[name]; }, setTimeout, clearTimeout });
  return module.exports;
}
const links = load('src/navigation/publicLinks.ts', {});
test('public links open native menu, queue aliases and platform', () => {
  assert.equal(links.parsePublicLink('https://pos.example/menu/abc-123').params.tableToken, 'abc-123');
  assert.equal(links.parsePublicLink('edupos://menu/abc-123').screen, 'QrMenu');
  assert.equal(links.parsePublicLink('/q/ABC').params.code, 'ABC');
  assert.equal(links.parsePublicLink('/queue?cafe=venue').params.cafe, 'venue');
  assert.equal(links.parsePublicLink('/platform/cafes').screen, 'Platform');
});
test('malformed and unrelated links cannot become native routes', () => {
  for (const link of ['javascript:alert(1)', '/menu/%2Fsecret', '/menu/%ZZ', '/waiter/orders', '', '//example/menu/a', '/menu/a/extra']) assert.equal(links.parsePublicLink(link), null, link);
});
function qrClient() {
  const calls = [];
  const client = {};
  for (const method of ['get', 'post', 'patch', 'delete']) client[method] = async (...args) => { calls.push({ method, args }); return { data: { sessionId: 'session' } }; };
  let config;
  const qr = load('src/services/api/qr.ts', {
    axios: { create: value => { config = value; return client; } },
    '@tanstack/react-query': { useQuery: value => value, useMutation: value => value, useQueryClient: () => ({ setQueryData() {}, invalidateQueries() {}, cancelQueries: async () => {}, getQueryData: () => null }) },
    '@/config/env': { API_URL: 'https://test.invalid' },
    './guest': { getGuestKey: async () => 'persistent-guest', getGuestPosition: async () => null },
  });
  return { qr, calls, getConfig: () => config };
}
test('QR client keeps public requests independent of staff authentication', () => {
  const { getConfig } = qrClient();
  assert.equal(getConfig().baseURL, 'https://test.invalid/api/public');
  assert.equal(getConfig().headers.Authorization, undefined);
});
test('join, edit and submit use persisted guest identity and correct API contracts', async () => {
  const { qr, calls } = qrClient();
  await qr.joinSession('table', true);
  await qr.useAddItem('table').mutationFn({ dishId: 'dish', variantId: 'variant', quantity: 2, lat: 42, lng: 74 });
  await qr.useUpdateItem('table').mutationFn({ itemId: 'item', quantity: 3 });
  await qr.useRemoveItem('table').mutationFn('item');
  await qr.useSubmitOrder('table').mutationFn({ lat: 42, lng: 74 });
  assert.equal(calls[0].args[0], '/qr-session/table/join');
  assert.equal(calls[0].args[1].guestKey, 'persistent-guest');
  assert.equal(calls[0].args[1].reopen, true);
  assert.equal(calls[1].args[1].variantId, 'variant');
  assert.equal(calls[2].method, 'patch');
  assert.equal(calls[3].args[1].params.guestKey, 'persistent-guest');
  assert.equal(calls[4].args[1].lat, 42);
  assert.equal(calls[4].args[1].guestKey, 'persistent-guest');
});
