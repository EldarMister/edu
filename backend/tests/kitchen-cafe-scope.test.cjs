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
