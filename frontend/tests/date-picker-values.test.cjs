const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const filename = resolve(__dirname, '../src/components/date-picker-values.ts');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const exportsObject = { exports: {} };
new Function('module', 'exports', compiled.outputText)(exportsObject, exportsObject.exports);
const { validateDateInput, dateToDisplay, nextDateTimeForTime } = exportsObject.exports;

test('editing time keeps a historical date across an intermediate empty native time value', () => {
  let committed = '2024-02-29T13:20';
  for (const time of ['', '09:', '09:45']) {
    const next = nextDateTimeForTime(committed, time, '2026-11-14');
    if (next !== undefined) committed = next;
  }
  assert.equal(committed, '2024-02-29T09:45');
});

test('midnight is valid and entering time in a genuinely empty picker retains the existing today default', () => {
  assert.equal(nextDateTimeForTime('2024-02-29T13:20', '00:00', '2026-11-14'), '2024-02-29T00:00');
  assert.equal(nextDateTimeForTime('', '09:45', '2026-11-14'), '2026-11-14T09:45');
  assert.equal(nextDateTimeForTime('2024-02-29T13:20', '24:00', '2026-11-14'), undefined);
});

test('impossible and incomplete typed dates produce errors without a replacement or emitted ISO value', () => {
  assert.deepEqual(validateDateInput('31.02.2026'), { error: 'format' });
  assert.deepEqual(validateDateInput('14.11.'), { error: 'format' });
  assert.deepEqual(validateDateInput('29.02.2024'), { value: '2024-02-29' });
  assert.equal(dateToDisplay('2024-02-29'), '29.02.2024');
});

test('date limits and required/optional clearing are distinguishable', () => {
  assert.deepEqual(validateDateInput('13.11.2026', { min: '2026-11-14' }), { error: 'min' });
  assert.deepEqual(validateDateInput('15.11.2026', { max: '2026-11-14' }), { error: 'max' });
  assert.deepEqual(validateDateInput('14.11.2026', { min: '2026-11-14', max: '2026-11-14' }), { value: '2026-11-14' });
  assert.deepEqual(validateDateInput('', { required: true }), { error: 'required' });
  assert.deepEqual(validateDateInput(''), { value: '' });
});
