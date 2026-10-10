const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/settingsDraft.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleValue = { exports: {} };
vm.runInNewContext(output, { module: moduleValue, exports: moduleValue.exports });
const { changedSettingsFields, mergeSavedSettingsDraft } = moduleValue.exports;

test('editing cafe name does not send an unchanged stale QR over a newer server image', () => {
  const baseline = { cafeName: 'Cafe', qrImageUrl: 'old-bank-qr', deliveryEnabled: true };
  const draft = { ...baseline, cafeName: 'New Cafe' };
  const patch = changedSettingsFields(draft, baseline);
  assert.deepEqual(Object.keys(patch), ['cafeName']);
  assert.equal(patch.cafeName, 'New Cafe');
  assert.equal('qrImageUrl' in patch, false);
  assert.equal('deliveryEnabled' in patch, false);
});

test('explicit QR deletion is sent, while unchanged nullable fields stay omitted', () => {
  const patch = changedSettingsFields({ qrImageUrl: '', qrGeoLat: null }, { qrImageUrl: 'bank-qr', qrGeoLat: null });
  assert.equal(patch.qrImageUrl, '');
  assert.equal('qrGeoLat' in patch, false);
});

test('save response adopts authoritative fields and preserves QR uploaded while saving', () => {
  const submitted = { cafeName: 'New Cafe', qrImageUrl: 'old-bank-qr', phone: '123' };
  const current = { ...submitted, qrImageUrl: 'new-upload', phone: '456' };
  const saved = { ...submitted, cafeName: 'New Cafe (normalized)', qrImageUrl: 'remote-bank-qr' };
  const next = mergeSavedSettingsDraft(submitted, current, saved);
  assert.equal(next.form.cafeName, saved.cafeName);
  assert.equal(next.form.qrImageUrl, 'new-upload');
  assert.equal(next.form.phone, '456');
  assert.equal(next.dirty, true);
  assert.equal(changedSettingsFields(next.form, saved).qrImageUrl, 'new-upload');
});

test('completed save with no new edits adopts server snapshot and clears dirty state', () => {
  const submitted = { cafeName: 'Cafe', qrImageUrl: '' };
  const saved = { cafeName: 'Cafe', qrImageUrl: null };
  const next = mergeSavedSettingsDraft(submitted, submitted, saved);
  assert.equal(next.form.qrImageUrl, null);
  assert.equal(next.dirty, false);
});
