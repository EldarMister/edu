require('ts-node/register/transpile-only');
const test=require('node:test');const assert=require('node:assert/strict');
const {EventsGateway}=require('../src/realtime/events.gateway.ts');
const {runWithTenant}=require('../src/tenant/tenant-context.ts');
test('kitchen events reach kitchen, bar and admins only inside the order cafe',async()=>{
 const users=[['a-k','KITCHEN','a'],['a-b','BAR','a'],['a-admin','ADMIN','a'],['b-k','KITCHEN','b'],['b-admin','OWNER','b'],['legacy','KITCHEN',null]];
 const clients=users.map(([id,role,cafeId])=>({id,data:{},handshake:{auth:{token:id}},rooms:new Set(),events:[],join(room){this.rooms.add(room);},disconnect(){throw Error('unexpected disconnect');}}));
 const gateway=new EventsGateway({verifyAsync:async sub=>({sub})},{user:{findUnique:async({where})=>{const u=users.find(v=>v[0]===where.id);return {id:u[0],role:u[1],cafeId:u[2],name:u[0],isActive:true};}},cafe:{findUnique:async()=>({status:'active'})}});
 gateway.server={to:room=>({emit:(event,payload)=>clients.filter(c=>c.rooms.has(room)).forEach(c=>c.events.push(payload.id))})};
 for(const client of clients)await gateway.handleConnection(client);
 gateway.emitToKitchen('kitchen:new_order',{id:'order-a',cafeId:'a'});
 gateway.emitToKitchen('order:status_changed',{id:'order-b',cafeId:'b'});
 await runWithTenant({cafeId:'a'},()=>gateway.emitToKitchen('order:new',{id:'context-a'}));
 gateway.emitToKitchen('order:new',{id:'unscoped'});
 for(const client of clients){const cafe=users.find(u=>u[0]===client.id)[2];assert.deepEqual(client.events,cafe==='a'?['order-a','context-a']:cafe==='b'?['order-b']:['unscoped']);}
});

test('QR orders, receipt speech and table changes reach only the appropriate cafe rooms', async () => {
  const users = [
    ['a-waiter', 'WAITER', 'a'], ['a-kitchen', 'KITCHEN', 'a'],
    ['a-admin', 'ADMIN', 'a'], ['a-owner', 'OWNER', 'a'],
    ['b-waiter', 'WAITER', 'b'], ['b-admin', 'ADMIN', 'b'],
  ];
  const clients = [...users, ['guest']].map(([id, role]) => ({
    id, data: {}, handshake: { auth: role ? { token: id } : {} },
    rooms: new Set(), events: [],
    join(room) { this.rooms.add(room); },
    disconnect() { throw Error('unexpected disconnect'); },
  }));
  const gateway = new EventsGateway({ verifyAsync: async (sub) => ({ sub }) }, {
    user: { findUnique: async ({ where }) => {
      const [id, role, cafeId] = users.find(([id]) => id === where.id);
      return { id, role, cafeId, isActive: true };
    } },
    cafe: { findUnique: async () => ({ status: 'active' }) },
  });
  gateway.server = { to: (room) => ({ emit: (event) => {
    for (const client of clients) if (client.rooms.has(room)) client.events.push(event);
  } }) };
  for (const client of clients) await gateway.handleConnection(client);
  await runWithTenant({ cafeId: 'a' }, () => {
    gateway.emitToWaiters('notification:new', { message: 'QR notification' });
    gateway.emitToAdmin('order:status_changed', { cafeId: 'a' });
    gateway.emitToAdminOnly('receipt_print_request_created', { voice: { text: 'Receipt speech' } });
    gateway.emitBroadcast('table:status_changed', { id: 'table-a' });
  });
  assert.deepEqual(clients.map(({ events }) => events), [
    ['notification:new', 'table:status_changed'],
    ['table:status_changed'],
    ['order:status_changed', 'receipt_print_request_created', 'table:status_changed'],
    ['order:status_changed', 'table:status_changed'],
    [], [], [],
  ]);
});

test('QR socket joins require the table token or a guest key issued for that visit', async () => {
  const gateway = new EventsGateway({}, {
    table: { findFirst: async ({ where }) => where.id === 'table-a' ? { cafeId: 'a', qrToken: 'token-a' } : null },
    cafe: { findUnique: async () => ({ status: 'active' }) },
    qrTableSession: { findFirst: async ({ select }) => select?.guests
      ? { guests: select.guests.where.guestKey === 'guest-a' ? [{ id: 'valid-guest' }] : [] }
      : null },
    qrSessionItem: { deleteMany: async () => ({ count: 0 }) },
  });
  const payloads = [];
  gateway.server = { to: () => ({ emit: (_event, payload) => payloads.push(payload) }) };
  const client = { data: {}, rooms: new Set(), join(room) { this.rooms.add(room); }, leave(room) { this.rooms.delete(room); } };
  assert.deepEqual(await gateway.handleQrJoin(client, { tableId: 'table-a', guestKey: 'guest-b' }), { ok: false });
  assert.equal(client.rooms.size, 0);
  assert.deepEqual(await gateway.handleQrJoin(client, { tableId: 'table-a', guestKey: 'guest-a' }), { ok: true });
  assert.deepEqual(await gateway.handleQrJoin(client, { tableId: 'table-a', guestKey: 'new-guest', tableToken: 'token-a' }), { ok: true });
  await gateway.handleQrLeave(client, { tableId: 'table-a' });
  assert.ok(payloads.every((payload) => !('guestKey' in payload)));
});
