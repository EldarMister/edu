const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function source(file, modules = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/finance/', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { exports: module.exports, require: (name) => modules[name] });
  return module.exports;
}

const format = source('format.ts');
const rules = source('rules.ts', { './format': format });
const flow = source('cash-flow-table.ts', { './format': format });

test('validates sums and timestamps in the venue timezone', () => {
  assert.equal(format.parseMoney('100,20'), 100.2);
  assert.equal(format.parseMoney('-2.50'), -2.5);
  assert.equal(format.parseMoney('123.001'), null);
  assert.equal(rules.transactionDate('2024-02-29', '08:30').toISOString(), '2024-02-29T02:30:00.000Z');
  assert.equal(rules.transactionDate('2025-02-29', '08:30'), null);
  assert.equal(rules.transactionDate('2026-11-21', '24:00'), null);
});

test('category choices keep their parent path and prohibit choosing a descendant as parent', () => {
  const top = { id: 'top', name: 'Склад', parentId: null, kind: 'both' };
  const child = { id: 'child', name: 'Поставка', parentId: top.id, kind: 'expense' };
  const categories = [top, child];
  assert.equal(rules.categoryChoices(categories)[1].label, 'Склад / Поставка');
  assert.equal(rules.compatibleParent(categories, child, top.id), false);
  assert.equal(rules.compatibleParent(categories, top, child.id), true);
  assert.equal(rules.acceptsTransaction(child, 'transfer'), false);
});

test('cash-flow cells preserve cents, transfers, and reversals across filters', () => {
  const accounts = [
    { id: 'cash', name: 'Касса', type: 'cash' },
    { id: 'bank', name: 'Банк', type: 'noncash' },
  ];
  const snapshot = {
    opening: 100,
    closing: 112.3,
    accountOpening: { cash: 100, bank: 0 },
    days: [{ date: '2026-11-21', income: 12.3, expense: 0, net: 12.3, balance: 112.3 }],
  };
  const entry = (id, accountId, kind, amount, other = {}) => ({
    id, accountId, kind, amount, occurredAt: '2026-11-21T09:30:00.000Z', ...other,
  });
  const model = flow.buildCashFlowTable(snapshot, accounts, [], [
    entry('income', 'cash', 'sale', 12.3),
    entry('old', 'cash', 'sale', 20, { reversedAt: '2026-11-21T10:00:00.000Z' }),
    entry('rev', 'cash', 'adjustment', -20, { reversalOf: 'old' }),
    entry('out', 'cash', 'transfer', -40),
    entry('in', 'bank', 'transfer', 40),
  ], '2026-11-01', '2026-11-30');
  const november = model.periods[0];
  const find = (key) => model.lines.find(({ id }) => id === key);
  const value = (key, type) => flow.flowCell(find(key), { period: november, type }, model.byAccount).cents;
  assert.equal(value('income'), 1230);
  assert.equal(value('transfers'), 0);
  assert.equal(value('transfers', 'cash'), -4000);
  assert.equal(value('closing', 'noncash'), 4000);
  assert.equal(value('net'), 1230);
});
