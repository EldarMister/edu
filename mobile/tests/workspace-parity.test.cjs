const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, require: (dependency) => dependencies[dependency] });
  return module.exports;
}

const permissions = load('lib/permissions.ts');
const { homeWorkspace, activeWorkspace, workspacePermissions, workspaceRole } = load('lib/workspaces.ts', { './permissions': permissions });
const { normalizeAmount, quickCashAmounts, tenderTotals } = load('screens/waiter/paymentAmounts.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));

test('built-in workplace access routes stockkeepers and cashiers independently of the stored role', () => {
  assert.equal(homeWorkspace({ role: 'ADMIN', access: { admin: false, terminal: true, production: null } }), 'terminal');
  assert.equal(homeWorkspace({ role: 'WAITER', access: { admin: true, terminal: false, production: null } }), 'admin');
  assert.equal(activeWorkspace({ role: 'KITCHEN' }, 'admin'), 'production');
  assert.equal(homeWorkspace({ role: 'WAITER', access: { admin: false, terminal: false, production: null } }), null);
});

test('terminal permissions keep enabled payments and delivery without inheriting admin powers', () => {
  const user = { role: 'ADMIN', permissions: {
    terminalAccess: true,
    sections: { finance: true, warehouse: true },
    actions: { acceptOrderPayments: true, refundChecks: true, printReceipts: false, createDeliveryOrders: true },
  } };
  const projected = workspacePermissions(user, 'terminal');
  assert.equal(workspaceRole(user, 'terminal'), 'WAITER');
  assert.equal(projected.actions.acceptOrderPayments, true);
  assert.equal(projected.actions.createDeliveryOrders, true);
  assert.equal(projected.actions.printReceipts, false);
  assert.equal(projected.actions.refundChecks, false);
  assert.equal(projected.sections.finance, false);
  assert.equal(projected.sections.warehouse, false);
});

test('owner restrictions survive projection to admin and the terminal', () => {
  const user = { role: 'OWNER', permissions: { ownerOperations: { cancelItems: false, printRequests: false } } };
  for (const workspace of ['admin', 'terminal']) {
    const projected = workspacePermissions(user, workspace);
    assert.deepEqual(plain(projected.ownerOperations), { refunds: true, cancelOrders: true, cancelItems: false, printRequests: false });
    assert.equal(projected.actions.acceptOrderPayments, true);
  }
  assert.equal(workspacePermissions(user, 'terminal').actions.requestReceiptPrints, false);
});

test('tablets convert cash overpayment to change and reject only excess non-cash payments', () => {
  assert.deepEqual(plain(tenderTotals(150, { cash: 200, card: 60, qr: 20 })), {
    amounts: { cash: 70, card: 60, qr: 20 }, remaining: 0, change: 130, over: false,
  });
  assert.equal(tenderTotals(150, { cash: 30, card: 151, qr: 0 }).over, true);
  assert.equal(tenderTotals(150.01, { cash: 30, card: 120, qr: 0 }).remaining, 0.01);
  assert.deepEqual(plain(quickCashAmounts(1640)), [1700, 2000]);
  assert.equal(normalizeAmount(',50'), '0.50');
  assert.equal(normalizeAmount('1.123'), null);
});
