require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventsGateway } = require('../src/realtime/events.gateway.ts');
const { getDefaultPermissionsByRole } = require('../src/common/permissions.ts');

test('socket rooms follow validated workspace and one batched refresh disconnects revoked access', async () => {
  const permissions = getDefaultPermissionsByRole('ADMIN');
  permissions.terminalAccess = true;
  const mixed = { id: 'mixed', role: 'ADMIN', name: 'Mixed', phone: '1', cafeId: 'cafe', isActive: true,
    positionId: 'position', prepStation: null, permissions: null, position: { role: 'ADMIN', permissions } };
  const owner = { ...mixed, id: 'owner', role: 'OWNER', position: null, positionId: null };
  const employees = new Map([[mixed.id, mixed], [owner.id, owner]]);
  const queries = [];
  const gateway = new EventsGateway({ verifyAsync: async (token) => ({ sub: token }) }, {
    cafe: { findUnique: async () => ({ status: 'active' }) },
    user: { findUnique: async ({ where }) => employees.get(where.id),
      findMany: async ({ where }) => { queries.push(where.id.in); return where.id.in.map((id) => employees.get(id)).filter(Boolean); } },
  });
  const makeSocket = (id, token, workspace) => ({ id, handshake: { auth: { token, workspace } }, data: {}, rooms: [], disconnected: false,
    join(room) { this.rooms.push(room); }, disconnect() { this.disconnected = true; } });
  const terminal = makeSocket('terminal-device', mixed.id, 'terminal');
  const admin = makeSocket('admin-device', mixed.id, 'admin');
  const ownerSocket = makeSocket('owner-device', owner.id, 'admin');
  const guest = makeSocket('guest');
  for (const client of [terminal, admin, ownerSocket, guest]) await gateway.handleConnection(client);
  gateway.server = { sockets: { sockets: new Map([terminal, admin, ownerSocket, guest].map((client) => [client.id, client])) } };
  assert.ok(terminal.rooms.includes('cafe:cafe:waiters'));
  assert.ok(!terminal.rooms.includes('cafe:cafe:management'));
  assert.ok(admin.rooms.includes('cafe:cafe:management'));
  assert.equal(terminal.data.user.identityRole, 'ADMIN');
  assert.equal(terminal.data.user.role, 'WAITER');
  await gateway.revalidateStaffConnections();
  assert.deepEqual(queries, [['mixed', 'owner']], 'two devices for one employee share a single lookup');
  assert.ok([terminal, admin, ownerSocket, guest].every((client) => !client.disconnected));
  permissions.readOnlySections = ['staff'];
  await gateway.revalidateStaffConnections();
  assert.equal(admin.disconnected, true, 'changed administrative permissions leave management rooms');
  assert.equal(terminal.disconnected, false, 'unrelated administration rights do not change the terminal projection');
  permissions.terminalAccess = false;
  owner.isActive = false;
  await gateway.revalidateStaffConnections();
  assert.equal(terminal.disconnected, true);
  assert.equal(ownerSocket.disconnected, true);
  assert.equal(guest.disconnected, false);
  const forged = makeSocket('forged', mixed.id, 'terminal');
  await gateway.handleConnection(forged);
  assert.equal(forged.disconnected, true, 'reconnecting cannot restore a revoked workspace');
  gateway.onModuleDestroy();
});
