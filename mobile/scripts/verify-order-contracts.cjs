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
  const permissions = load('src/lib/order-permissions.ts');
  const rules = load('src/screens/waiter/orderRules.ts', { '@/utils/format': format, '@/lib/order-permissions': permissions });
  const orderStatuses = [
    'draft', 'sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready',
    'picked_up', 'served', 'waiting_payment', 'paid', 'rejected', 'partially_rejected', 'cancelled',
  ];
  const itemStatuses = ['new', 'accepted', 'cooking', 'ready', 'served'];
  const enumOf = (values) => Object.fromEntries(values.map((value) => [value, value]));
  class PolicyError extends Error {}
  const backendPolicy = load('../backend/src/orders/order-policy.ts', {
    '@nestjs/common': { BadRequestException: PolicyError, ForbiddenException: PolicyError },
    '@prisma/client': { OrderStatus: enumOf(orderStatuses), OrderItemStatus: enumOf([...itemStatuses, 'cancelled', 'rejected']) },
  });
  assert.deepEqual(permissions.DEFAULT_WAITER_PERMISSIONS, backendPolicy.normalizeWaiterOrderPermissions(null), 'Default permissions must match the server');
  const policyVariants = [
    backendPolicy.normalizeWaiterOrderPermissions(null),
    Object.fromEntries(backendPolicy.WAITER_ORDER_STAGES.map((stage) => [stage, { edit: true, cancel: true }])),
    Object.fromEntries(backendPolicy.WAITER_ORDER_STAGES.map((stage, index) => [stage, { edit: index % 2 === 0, cancel: index % 2 !== 0 }])),
  ];
  for (const policy of policyVariants) {
    for (const status of backendPolicy.WAITER_ORDER_STAGES) {
      for (const itemStatus of itemStatuses) {
        const item = { id: 'item-1', status: itemStatus };
        const order = { status, items: [item], payments: [] };
        assert.equal(permissions.itemPermissionStage(order, item), backendPolicy.waiterItemStage(status, itemStatus), `Stage drifted: ${status}/${itemStatus}`);
        for (const action of ['cancel', 'edit']) {
          let allowed = true;
          try { backendPolicy.assertWaiterItemOperation(policy, status, item, action); }
          catch (error) { if (!(error instanceof PolicyError)) throw error; allowed = false; }
          assert.equal(permissions.waiterItemPermission(order, item, action, policy).allowed, allowed, `Permission drifted: ${status}/${itemStatus}/${action}`);
          if (action === 'cancel') assert.equal(rules.canWaiterCancelOrder(order, policy), allowed);
        }
      }
    }
  }
  const printable = backendStatuses('backend/src/receipt-prints/receipt-prints.service.ts', 'PRELIMINARY_ORDER_STATUSES');
  const base = { waiter: { id: 'waiter-1' }, requiresWaiterDecision: false, table: { id: 'table-1', number: 5, hall: { name: 'Зал' } } };

  for (const status of orderStatuses) {
    const order = { ...base, status };
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
  const ok = async (url, body) => { calls.push({ url, body }); return { data: { id: 'order-1' } }; };
  const kitchen = load('src/services/api/kitchen.ts', {
    '@tanstack/react-query': { useMutation: (options) => options, useQueryClient: () => queryClient, useQuery: (options) => options },
    '@/lib/api': { networkRetry: false, api: { post: ok, get: ok, patch: ok } },
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
  const customStation = 'd551792e-c4db-46ba-932c-ea5f1e9fc074';
  await kitchen.useKitchenOrders('cancelled', customStation, { from: '2026-11-10', to: '2026-11-13' }).queryFn();
  await kitchen.useSaveStopList(customStation).mutationFn([{ dishId: 'dish-1', isAvailable: false }]);
  await kitchen.useReadyItems('bar').mutationFn({ ...payload, station: customStation });
  assert.equal(calls[2].url, `/kitchen/orders?tab=cancelled&station=${customStation}&from=2026-11-10&to=2026-11-13`);
  assert.equal(calls[3].url, `/kitchen/stop-list?station=${customStation}`);
  assert.equal(calls[4].url, `/kitchen/orders/order-1/items/ready-batch?station=${customStation}`);
  const { cartStations } = load('src/utils/prepStation.ts');
  const routed = cartStations([{ dish: { categoryId: 'grill' } }], [{ id: 'grill', prepStation: customStation }]);
  assert.equal(routed.hasPrep, true);
  assert.equal(routed.multipleOrCustom, true);
  assert.equal(cartStations([{ dish: { categoryId: 'grill', prepStation: 'none' } }], [{ id: 'grill', prepStation: customStation }]).hasPrep, false);
  console.log('Order contracts passed: waiter policy matrix, receipt statuses, delivery identity, batch actions and custom station routing.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
