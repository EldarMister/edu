require('ts-node/register/transpile-only');
const test=require('node:test');const assert=require('node:assert/strict');
const {KitchenService}=require('../src/kitchen/kitchen.service.ts');
function fixture(){
 const now=new Date();const old=new Date(now);old.setDate(old.getDate()-2);
 const make=(id,status,itemStatus='served',prepStation='kitchen',at=now)=>({id,status,createdAt:at,updatedAt:at,closedAt:status==='paid'?at:null,items:[{id:id+'-item',prepStation,status:itemStatus}]});
 const rows=[make('ready','ready','ready'),make('served','served'),make('waiting','waiting_payment'),make('paid','paid'),make('bar-waiting','waiting_payment','served','bar'),make('cooking','cooking','cooking'),make('old','waiting_payment','served','kitchen',old),make('cancelled','cancelled','cancelled'),make('rejected','rejected','rejected')];
 const statusMatch=(status,where)=>where.OR?where.OR.some(w=>statusMatch(status,w)):typeof where.status==='string'?status===where.status:where.status.in.includes(status);
 const service=new KitchenService({order:{findMany:async({where})=>rows.filter(o=>statusMatch(o.status,where)&&o.items.some(i=>i.prepStation===where.items.some.prepStation&&(!where.items.some.status||!where.items.some.status.notIn.includes(i.status))))}}, {}, {});
 return {service,rows};
}
test('served -> waiting payment -> paid stays in kitchen completed history',async()=>{
 const {service}=fixture();const ids=(await service.findByTab('ready','kitchen')).map(o=>o.id).sort();assert.deepEqual(ids,['paid','ready','served','waiting']);
 for(const tab of ['new','in_work']){const ids=(await service.findByTab(tab,'kitchen')).map(o=>o.id);assert.ok(!ids.includes('served'));assert.ok(!ids.includes('waiting'));assert.ok(!ids.includes('paid'));}
});
test('completed histories stay isolated by preparation station and keep today only',async()=>{
 const {service}=fixture();assert.deepEqual((await service.findByTab('ready','bar')).map(o=>o.id),['bar-waiting']);assert.deepEqual((await service.findByTab('in_work','kitchen')).map(o=>o.id),['cooking']);assert.deepEqual((await service.findByTab('rejected','kitchen')).map(o=>o.id),['rejected']);
});
