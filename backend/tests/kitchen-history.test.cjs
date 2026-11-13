require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { KitchenService } = require('../src/kitchen/kitchen.service.ts');

const day = '2026-11-10';
const at = (hour) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+06:00`);
const item = (id, prepStation, status, updatedAt = at(10)) => ({ id, prepStation, status, updatedAt });
const order = (id, status, items, kitchenEvents = [], updatedAt = at(10)) => ({
  id, status, items, kitchenEvents, updatedAt, closedAt: null,
});
const event = (type, entry, createdAt, reason = null) => ({
  type, orderItemId: entry.id, prepStation: entry.prepStation, createdAt, reason,
});

function fixture(rows) {
  const requests = [];
  const service = new KitchenService({
    order: { findMany: async (query) => { requests.push(query); return rows; } },
  }, {}, {});
  return { service, requests };
}

test('bar completes independently while the kitchen is still cooking', async () => {
  const drink = item('drink', 'bar', 'ready', at(12));
  const hot = item('hot', 'kitchen', 'cooking');
  const { service, requests } = fixture([order('split', 'cooking', [drink, hot], [event('ready_item', drink, at(11))])]);
  const [entry] = await service.findByTab('ready', 'bar', day, day);
  assert.equal(entry.stationHistoryAt.toISOString(), at(11).toISOString());
  assert.deepEqual(entry.items.map(({ id }) => id), ['drink']);
  assert.equal(requests[0].include.items.where.prepStation, 'bar');
  assert.equal(requests[0].where.OR[0].items.some.prepStation, 'bar');
  assert.deepEqual(await service.findByTab('ready', 'kitchen', day, day), []);
  assert.deepEqual((await service.findByTab('in_work', 'kitchen')).map(({ id }) => id), ['split']);
});

test('partial bar cancellation appears by its event date with the recorded reason', async () => {
  const drink = item('cancelled-drink', 'bar', 'cancelled', at(15));
  const ready = item('ready-drink', 'bar', 'ready', at(12));
  const hot = item('hot', 'kitchen', 'cooking', at(15));
  const { service } = fixture([order('split', 'cooking', [drink, ready, hot], [
    event('cancel', drink, at(11), 'Гость передумал'),
    event('ready_item', ready, at(12)),
  ], at(15))]);
  const [entry] = await service.findByTab('cancelled', 'bar', day, day);
  assert.equal(entry.stationHistoryAt.toISOString(), at(11).toISOString());
  assert.deepEqual(entry.items.map(({ id, rejectReason }) => [id, rejectReason]), [['cancelled-drink', 'Гость передумал']]);
  assert.deepEqual((await service.findByTab('ready', 'bar', day, day))[0].items.map(({ id }) => id), ['ready-drink']);
  assert.deepEqual(await service.findByTab('cancelled', 'kitchen', day, day), []);
  assert.deepEqual(await service.findByTab('cancelled', 'bar', '2026-11-11', '2026-11-11'), []);
});

test('served, waiting-payment and paid orders retain station completion time', async () => {
  const stations = ['kitchen', 'dessert'];
  const states = ['served', 'waiting_payment', 'paid'];
  const { service } = fixture(stations.flatMap((station) => states.map((status) => {
    const entry = item(`${station}-${status}`, station, 'served', at(15));
    return order(entry.id, status, [entry], [event('ready_item', entry, at(11))], at(15));
  })));
  const entries = await service.findByTab('ready', 'dessert', day, day);
  assert.deepEqual(entries.map(({ id }) => id), ['dessert-paid', 'dessert-served', 'dessert-waiting_payment']);
  assert.ok(entries.every((entry) => entry.stationHistoryAt.getTime() === at(11).getTime()));
});

test('history rejects invalid dates and caps the date range', async () => {
  const { service, requests } = fixture([]);
  await assert.rejects(service.findByTab('ready', 'bar', '2026-02-30'), { status: 400 });
  await assert.rejects(service.findByTab('ready', 'bar', '2026-10-01', '2026-11-05'), { status: 400 });
  assert.equal(requests.length, 0);
});
