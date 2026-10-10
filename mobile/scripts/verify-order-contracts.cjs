/* Verifies native workflow rules and payloads against the checked-in backend. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const mobile = path.resolve(__dirname, '..');
const repo = path.resolve(mobile, '..');

function load(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(mobile, relative), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    }, module, module.exports,
  );
  return module.exports;
}

function backendStatuses(file, declaration) {
  const source = fs.readFileSync(path.join(repo, file), 'utf8');
  const block = source.match(new RegExp(`${declaration}: OrderStatus\\[\\] = \\[([\\s\\S]*?)\\];`));
  assert.ok(block, `Backend status contract not found: ${declaration}`);
  return new Set([...block[1].matchAll(/OrderStatus\.(\w+)/g)].map((match) => match[1]));
}

async function main() {
  const format = load('src/utils/format.ts');
  const rules = load('src/screens/waiter/orderRules.ts', { '@/utils/format': format });
  const orderStatuses = [
    'draft', 'sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready',
    'picked_up', 'served', 'waiting_payment', 'paid', 'rejected', 'partially_rejected', 'cancelled',
  ];
  const cancellable = backendStatuses('backend/src/orders/orders.service.ts', 'waiterCancellableStatuses');
  const printable = backendStatuses('backend/src/receipt-prints/receipt-prints.service.ts', 'PRELIMINARY_ORDER_STATUSES');
  const base = { waiter: { id: 'waiter-1' }, requiresWaiterDecision: false, table: { id: 'table-1', number: 5, hall: { name: 'Зал' } } };

  for (const status of orderStatuses) {
    const order = { ...base, status };
    assert.equal(rules.canWaiterCancelOrder(order), cancellable.has(status), `Cancel rule drifted for ${status}`);
    assert.equal(rules.canRequestPreliminaryBill(order), printable.has(status), `Bill rule drifted for ${status}`);
  }
  assert.equal(rules.canRequestPreliminaryBill({ ...base, status: 'ready', requiresWaiterDecision: true }), false);
  assert.equal(rules.canRequestPreliminaryBill({ ...base, status: 'ready', waiter: null }), false);

  const delivery = { ...base, status: 'ready', source: 'delivery', waiter: null,
    table: { id: 'delivery-table:cafe', number: 0, hall: { name: '__DELIVERY__' } },
    externalOrderId: 'external-1', deliveryCustomerName: 'Клиент', deliveryCustomerPhone: '+996555123456', deliveryAddress: 'Адрес' };
  assert.equal(rules.orderLocation(delivery), 'Доставка · external-1');
  assert.notEqual(rules.orderLocation(delivery), rules.orderLocation({ ...delivery, externalOrderId: 'external-2' }));
  assert.equal(rules.deliveryDetails(delivery), 'Клиент · +996555123456 · Адрес');
  assert.equal(rules.deliveryDetails(base), null);

  const calls = [];
  const queryClient = { invalidateQueries() {} };
  const kitchen = load('src/services/api/kitchen.ts', {
    '@tanstack/react-query': { useMutation: (options) => options, useQueryClient: () => queryClient, useQuery: (options) => options },
    '@/lib/api': { networkRetry: false, api: { post: async (url, body) => { calls.push({ url, body }); return { data: { id: 'order-1' } }; } } },
  });
  const payload = { orderId: 'order-1', itemIds: ['dish-1'], setComponentIds: ['set-1'], partial: [{ itemId: 'dish-1', quantity: 2 }] };
  await kitchen.useReadyItems('bar').mutationFn(payload);
  await kitchen.useRejectItems('kitchen').mutationFn(payload);
  assert.equal(calls[0].url, '/kitchen/orders/order-1/items/ready-batch?station=bar');
  assert.equal(calls[1].url, '/kitchen/orders/order-1/items/reject-batch?station=kitchen');
  for (const call of calls) {
    assert.deepEqual(call.body.partial, payload.partial, 'Partial quantity must reach the backend');
    assert.deepEqual(call.body.itemIds, payload.itemIds);
    assert.deepEqual(call.body.setComponentIds, payload.setComponentIds);
  }
  console.log('Order contracts passed: 12 lifecycle statuses, bill eligibility, delivery identity, partial ready/reject API payloads.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
