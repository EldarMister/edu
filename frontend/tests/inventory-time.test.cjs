const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const moduleValue = { exports: {} };
const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '../src/features/admin/pages/warehouse/inventory-time.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
new Function('require', 'module', 'exports', outputText)(require, moduleValue, moduleValue.exports);
const { inventoryLocalTime, inventoryTimeIso, inventoryTimingFor, inventoryTimingValue, inventoryTimingError, inventoryTimeDisplay } = moduleValue.exports;

test('a Bishkek count time is converted to the same instant in browsers from different time zones', () => {
  const previousTimezone = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Bishkek']) {
      process.env.TZ = timezone;
      assert.equal(inventoryTimeIso('2026-11-15T00:30'), '2026-11-14T18:30:00.000Z');
      assert.equal(inventoryLocalTime('2026-11-14T18:30:00Z'), '2026-11-15T00:30');
      assert.match(inventoryTimeDisplay('2026-11-14T18:30:00Z'), /15\.11\.2026,? 00:30/);
    }
  } finally { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; }
});

test('incomplete and impossible calendar/time values never become shifted valid timestamps', () => {
  for (const invalid of ['', '2026-02-29T12:00', '2026-11-31T12:00', '2026-11-15T24:00', '2026-11-15T12:60', 'T12:00', '2026-11-15T'])
    assert.equal(inventoryTimeIso(invalid), undefined, invalid);
  assert.equal(inventoryTimeIso('2024-02-29T12:00'), '2024-02-29T06:00:00.000Z');
});

test('present-time mode is explicit null and opening a saved minute editor preserves its seconds', () => {
  assert.equal(inventoryTimingValue({ mode: 'current', local: '' }), null);
  const saved = '2026-11-14T18:30:42.123Z';
  const timing = inventoryTimingFor(saved);
  assert.deepEqual(timing, { mode: 'past', local: '2026-11-15T00:30' });
  assert.equal(inventoryTimingValue(timing, saved), saved);
  assert.equal(inventoryTimingValue({ ...timing, local: '2026-11-15T00:31' }, saved), '2026-11-14T18:31:00.000Z');
});

test('future checks use the selected instant, not the computer calendar day', () => {
  const now = new Date('2026-11-14T18:30:00Z');
  assert.equal(inventoryTimingError({ mode: 'past', local: '2026-11-15T00:30' }, now), '');
  assert.match(inventoryTimingError({ mode: 'past', local: '2026-11-15T00:31' }, now), /будущем/);
  assert.match(inventoryTimingError({ mode: 'past', local: '' }, now), /Укажите/);
  assert.equal(inventoryTimingError({ mode: 'current', local: 'invalid' }, now), '');
});
