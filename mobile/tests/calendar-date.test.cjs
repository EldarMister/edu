const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/calendarDate.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleValue = { exports: {} };
vm.runInNewContext(output, { module: moduleValue, exports: moduleValue.exports, Date });
const { dateToIso, displayDate, parseDisplayDate, parseIsoDate, calendarMonth, shiftCalendarMonth, calendarCells, isAllowedDate } = moduleValue.exports;

test('strict ISO and display formats reject partial dates, timestamps and whitespace', () => {
  for (const value of ['', '2026-2-01', '26-02-01', '2026/02/01', '2026-02-01T00:00:00Z', ' 2026-02-01', '2026-02-01\n']) {
    assert.equal(parseIsoDate(value), null, value);
    assert.equal(displayDate(value), '', value);
  }
  for (const value of ['', '1.02.2026', '01.2.2026', '01.02.26', '01/02/2026', ' 01.02.2026', '01.02.2026\n']) {
    assert.equal(parseDisplayDate(value), null, value);
  }
});

test('invalid calendar dates are rejected rather than rolled into another month', () => {
  for (const iso of ['0000-01-01', '10000-01-01', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-04-31', '2026-02-29', '1900-02-29', '2100-02-29']) {
    assert.equal(parseIsoDate(iso), null, iso);
  }
  for (const text of ['00.01.2026', '31.04.2026', '29.02.1900', '29.02.2100', '01.01.0000']) {
    assert.equal(parseDisplayDate(text), null, text);
  }
});

test('leap centuries and years below 100 round-trip without Date constructor remapping', () => {
  for (const [iso, displayed] of [['0001-01-01', '01.01.0001'], ['0004-02-29', '29.02.0004'], ['0099-12-31', '31.12.0099'], ['0400-02-29', '29.02.0400'], ['2000-02-29', '29.02.2000'], ['2024-02-29', '29.02.2024'], ['9999-12-31', '31.12.9999']]) {
    const date = parseIsoDate(iso);
    assert.ok(date, iso);
    assert.equal(date.getHours(), 12, iso);
    assert.equal(dateToIso(date), iso);
    assert.equal(displayDate(iso), displayed);
    assert.equal(dateToIso(parseDisplayDate(displayed)), iso);
  }
  assert.equal(dateToIso(new Date(NaN)), '');
});

test('month selection uses the selected date or fallback without mutating either', () => {
  const fallback = parseIsoDate('2025-12-31');
  assert.equal(dateToIso(calendarMonth('2026-02-28', fallback)), '2026-02-01');
  assert.equal(dateToIso(calendarMonth('invalid', fallback)), '2025-12-01');
  assert.equal(dateToIso(fallback), '2025-12-31');
  assert.equal(calendarMonth('0001-05-12').getFullYear(), 1);
  assert.equal(calendarMonth('2026-02-28').getHours(), 12);
});

test('month navigation handles short months, year rollover and supported year limits', () => {
  const januaryEnd = parseIsoDate('2024-01-31');
  assert.equal(dateToIso(shiftCalendarMonth(januaryEnd, 1)), '2024-02-01');
  assert.equal(dateToIso(shiftCalendarMonth(januaryEnd, -1)), '2023-12-01');
  assert.equal(dateToIso(shiftCalendarMonth(januaryEnd, 13)), '2025-02-01');
  assert.equal(dateToIso(januaryEnd), '2024-01-31');
  assert.equal(dateToIso(shiftCalendarMonth(parseIsoDate('0001-01-01'), -1)), '0001-01-01');
  assert.equal(dateToIso(shiftCalendarMonth(parseIsoDate('9999-12-01'), 1)), '9999-12-01');
});

test('calendar covers complete Monday-first weeks with correct outside-month cells', () => {
  const cases = [
    ['2021-02-01', 28, '2021-02-01', '2021-02-28', 0],
    ['2021-09-15', 35, '2021-08-30', '2021-10-03', 5],
    ['2023-01-01', 42, '2022-12-26', '2023-02-05', 11],
    ['2024-02-29', 35, '2024-01-29', '2024-03-03', 6],
    ['0001-01-01', 35, '0001-01-01', '0001-02-04', 4],
  ];
  for (const [iso, length, first, last, outside] of cases) {
    const cells = calendarCells(parseIsoDate(iso));
    assert.equal(cells.length, length, iso);
    assert.equal(cells[0].iso, first, iso);
    assert.equal(cells.at(-1).iso, last, iso);
    assert.equal(cells.filter(cell => cell.outside).length, outside, iso);
    assert.equal(new Set(cells.map(cell => cell.iso)).size, length, iso);
    cells.forEach((cell, index) => {
      assert.equal(cell.date.getDay(), (index + 1) % 7, `${iso}: weekday ${index}`);
      assert.equal(cell.date.getHours(), 12, `${iso}: local noon ${index}`);
      assert.equal(dateToIso(cell.date), cell.iso);
    });
  }
});

test('date restrictions are inclusive and reject invalid dates or boundaries', () => {
  assert.equal(isAllowedDate('2026-10-11'), true);
  assert.equal(isAllowedDate('2026-10-11', '2026-10-11', '2026-10-11'), true);
  assert.equal(isAllowedDate('2026-10-11', '2026-10-12'), false);
  assert.equal(isAllowedDate('2026-10-11', undefined, '2026-10-10'), false);
  assert.equal(isAllowedDate('2026-10-11', '2026-11-01', '2026-10-01'), false);
  assert.equal(isAllowedDate('2026-02-30'), false);
  assert.equal(isAllowedDate('2026-10-11', 'invalid'), false);
  assert.equal(isAllowedDate('2026-10-11', undefined, '2026-02-30'), false);
  assert.equal(isAllowedDate('0001-01-01', '0001-01-01', '0099-12-31'), true);
  assert.equal(isAllowedDate('2026-10-11', '', ''), true);
});

test('parsing, calendar cells and month navigation preserve days in UTC offsets and DST zones', () => {
  const script = `
    const vm = require('node:vm');
    const output = require('node:fs').readFileSync(0, 'utf8');
    const moduleValue = { exports: {} };
    vm.runInNewContext(output, { module: moduleValue, exports: moduleValue.exports, Date });
    const h = moduleValue.exports;
    const dates = ['0001-01-01', '0099-12-31', '2024-03-10', '2024-11-03', '2026-10-11'];
    process.stdout.write(JSON.stringify({
      dates: dates.map(iso => ({ iso: h.dateToIso(h.parseIsoDate(iso)), hour: h.parseIsoDate(iso).getHours(), display: h.displayDate(iso) })),
      march: h.calendarCells(h.parseIsoDate('2024-03-10')).map(cell => cell.iso),
      next: h.dateToIso(h.shiftCalendarMonth(h.parseIsoDate('2024-01-31'), 1)),
      previous: h.dateToIso(h.shiftCalendarMonth(h.parseIsoDate('2024-01-31'), -1)),
    }));
  `;
  const expected = {
    dates: ['0001-01-01', '0099-12-31', '2024-03-10', '2024-11-03', '2026-10-11'].map(iso => ({ iso, hour: 12, display: displayDate(iso) })),
    march: Array.from(calendarCells(parseIsoDate('2024-03-10')), cell => cell.iso),
    next: '2024-02-01',
    previous: '2023-12-01',
  };
  for (const zone of ['UTC', 'Asia/Bishkek', 'Pacific/Kiritimati', 'Etc/GMT+12', 'America/Los_Angeles']) {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { input: output, encoding: 'utf8', env: { ...process.env, TZ: zone } }));
    assert.deepEqual(result, expected, zone);
  }
});
