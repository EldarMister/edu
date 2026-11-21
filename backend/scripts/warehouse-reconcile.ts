/** Read-only migration gate. Never changes stock or documents.
 * npx ts-node scripts/warehouse-reconcile.ts --save <snapshot.json>
 * npx ts-node scripts/warehouse-reconcile.ts --compare <snapshot.json>
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';

type Balance = { cafeId: string; ingredientId: string; warehouseKey: string; stock: string; avgCost: string };
const db = new PrismaClient();

async function main() {
  const snapshot = await db.$transaction(async (tx) => {
    const balances = await tx.$queryRaw<Balance[]>`
      SELECT cafe_id AS "cafeId", id AS "ingredientId", 'default' AS "warehouseKey", stock::text, avg_cost::text AS "avgCost" FROM ingredients
      UNION ALL
      SELECT s.cafe_id,s.ingredient_id,s.warehouse_id,s.stock::text,s.avg_cost::text
      FROM warehouse_stock s JOIN warehouses w ON w.id=s.warehouse_id WHERE NOT w.is_default
    `;
    // Before migration, include the exact expected mapping of legacy finished goods.
    // After migration these IDs already exist and are not counted twice.
    const legacy = await tx.$queryRaw<Balance[]>`
      SELECT d.cafe_id AS "cafeId", 'legacy:dish:'||d.id AS "ingredientId",
        CASE WHEN w.is_default THEN 'default' ELSE COALESCE(w.id,'default') END AS "warehouseKey", d.stock::text, '0' AS "avgCost"
      FROM dishes d JOIN categories c ON c.id=d.category_id
      LEFT JOIN station_warehouses r ON r.cafe_id=d.cafe_id AND r.station_id=COALESCE(d.prep_station,c.prep_station)
      LEFT JOIN warehouses w ON w.id=r.warehouse_id AND w.cafe_id=d.cafe_id
      WHERE d.track_inventory AND d.stock IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM recipe_items r WHERE r.dish_id=d.id)
      AND NOT EXISTS (SELECT 1 FROM dish_variants v WHERE v.dish_id=d.id AND v.stock IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM ingredients i WHERE i.id='legacy:dish:'||d.id)
      UNION ALL
      SELECT d.cafe_id,'legacy:variant:'||v.id,
        CASE WHEN w.is_default THEN 'default' ELSE COALESCE(w.id,'default') END,v.stock::text,'0'
      FROM dish_variants v JOIN dishes d ON d.id=v.dish_id JOIN categories c ON c.id=d.category_id
      LEFT JOIN station_warehouses r ON r.cafe_id=d.cafe_id AND r.station_id=COALESCE(d.prep_station,c.prep_station)
      LEFT JOIN warehouses w ON w.id=r.warehouse_id AND w.cafe_id=d.cafe_id
      WHERE d.track_inventory AND v.stock IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM recipe_items r WHERE r.dish_id=d.id)
      AND NOT EXISTS (SELECT 1 FROM ingredients i WHERE i.id='legacy:variant:'||v.id)
    `;
    const [integrity] = await tx.$queryRaw<Array<{ invalidMovements: number; foreignRecipeRows: number; foreignWarehouseStock: number }>>`
      SELECT (SELECT count(*)::int FROM stock_movements WHERE before_stock + change <> after_stock) AS "invalidMovements",
        (SELECT count(*)::int FROM recipe_items r JOIN ingredients i ON i.id=r.ingredient_id JOIN dishes d ON d.id=r.dish_id
          WHERE r.cafe_id IS DISTINCT FROM i.cafe_id OR r.cafe_id IS DISTINCT FROM d.cafe_id) AS "foreignRecipeRows",
        (SELECT count(*)::int FROM warehouse_stock s JOIN ingredients i ON i.id=s.ingredient_id JOIN warehouses w ON w.id=s.warehouse_id
          WHERE s.cafe_id IS DISTINCT FROM i.cafe_id OR s.cafe_id IS DISTINCT FROM w.cafe_id) AS "foreignWarehouseStock"
    `;
    const [records] = await tx.$queryRaw<Array<Record<string, number>>>`
      SELECT (SELECT count(*)::int FROM dishes) AS dishes,
        (SELECT count(*)::int FROM dish_variants) AS variants,
        (SELECT count(*)::int FROM recipe_items) AS "recipeItems",
        (SELECT count(*)::int FROM preparation_recipes) AS "preparationRecipes",
        (SELECT count(*)::int FROM purchases) AS purchases,
        (SELECT count(*)::int FROM warehouse_documents) AS "warehouseDocuments",
        (SELECT count(*)::int FROM orders) AS orders,
        (SELECT count(*)::int FROM order_items) AS "orderItems"
    `;
    return { capturedAt: new Date().toISOString(), balances: [...balances, ...legacy].sort((a,b) => key(a).localeCompare(key(b))), integrity, records };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const args = process.argv.slice(2);
  if (args[0] === '--save' && args[1]) writeFileSync(args[1], JSON.stringify(snapshot, null, 2), 'utf8');
  const discrepancies: string[] = [];
  if (args[0] === '--compare' && args[1]) {
    const previous = JSON.parse(readFileSync(args[1], 'utf8')) as { balances: Balance[]; records?: Record<string, number> };
    const current = new Map(snapshot.balances.map((balance) => [key(balance), balance]));
    for (const old of previous.balances) {
      const found = current.get(key(old));
      if (!found || !new Prisma.Decimal(old.stock).eq(found.stock) || !new Prisma.Decimal(old.avgCost).eq(found.avgCost)) discrepancies.push(key(old));
      current.delete(key(old));
    }
    for (const [id, balance] of current) if (!new Prisma.Decimal(balance.stock).isZero()) discrepancies.push(id);
    for (const [table, count] of Object.entries(previous.records ?? {})) {
      if (snapshot.records[table] !== count) discrepancies.push(`record-count:${table}`);
    }
  }
  const value = snapshot.balances.reduce((sum, balance) => sum.add(new Prisma.Decimal(balance.stock).mul(balance.avgCost)), new Prisma.Decimal(0));
  console.log(JSON.stringify({ balances: snapshot.balances.length, stockValue: value.toFixed(2),
    records: snapshot.records, ...snapshot.integrity, discrepancies, ok: !discrepancies.length && !Object.values(snapshot.integrity).some(Boolean) }, null, 2));
  if (discrepancies.length || Object.values(snapshot.integrity).some(Boolean)) process.exitCode = 1;
}

function key(balance: Balance) { return `${balance.cafeId}/${balance.warehouseKey}/${balance.ingredientId}`; }
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
