const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, modules = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/services', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  return module.exports;
}
const realtime = load('realtimeVoice.ts');
test('receipt speech matches PWA table words and preserves the server phrase', () => {
  const receipt = { id: 'r1', waiterName: 'Асан', tableNumber: 12, type: 'preliminary' };
  assert.equal(realtime.receiptRequestVoice(receipt), 'Официант Асан отправил заявку на печать счёта. Стол номер двенадцать.');
  assert.equal(realtime.receiptRequestVoice({ ...receipt, voice: { text: 'Серверная озвучка' } }), 'Серверная озвучка');
});
test('administrator speech dedupes foreground/background overlap separately from push presentation', () => {
  const speech = []; let clear;
  const service = load('adminVoice.ts', {
    './realtimeVoice': realtime,
    './waiterVoice': { waiterVoice: { enqueue: text => speech.push(text) } },
    '@/store/auth': { registerSessionCleanup: callback => { clear = callback; } },
  });
  const receipt = { id: 'r1', waiterName: 'Асан', tableNumber: 5, type: 'final' };
  service.announceReceiptRequest(receipt); service.announceReceiptRequest(receipt);
  assert.equal(speech.length, 1);
  const call = { orderId: 'o1', createdAt: 'now', voice: { text: 'Зовут администратора' } };
  service.announceAdministratorCall(call); service.announceAdministratorCall(call);
  assert.equal(speech.length, 2);
  service.announceAdministratorCall({ ...call, createdAt: 'later' });
  assert.equal(speech.length, 3);
  clear(); service.announceReceiptRequest(receipt);
  assert.equal(speech.length, 4);
});
