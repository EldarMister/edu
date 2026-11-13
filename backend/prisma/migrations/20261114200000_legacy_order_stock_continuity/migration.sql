-- Complete the one-time cutover while stock writers are stopped. Legacy
-- finished-goods quantities had no warehouse dimension or historical cost.
BEGIN;
LOCK TABLE ingredients,warehouse_stock,stock_movements,dishes,dish_variants,orders,order_items IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO warehouses(id,cafe_id,name,is_default)
SELECT 'warehouse:default:'||c.id,c.id,
 CASE WHEN EXISTS(SELECT 1 FROM warehouses w WHERE w.cafe_id=c.id AND w.name='Основной склад') THEN 'Основной склад ('||left(c.id,8)||')' ELSE 'Основной склад' END,true
FROM cafes c WHERE EXISTS(SELECT 1 FROM ingredients i WHERE i.cafe_id=c.id AND (i.id LIKE 'legacy:dish:%' OR i.id LIKE 'legacy:variant:%'))
AND NOT EXISTS(SELECT 1 FROM warehouses w WHERE w.cafe_id=c.id AND w.is_default);
CREATE TEMP TABLE legacy_stock_homes ON COMMIT DROP AS
WITH bindings AS (
 SELECT i.id AS ingredient_id,i.cafe_id,d.id AS dish_id,i.stock,i.avg_cost,COALESCE(d.prep_station,c.prep_station) AS station
 FROM ingredients i JOIN dishes d ON d.stock_ingredient_id=i.id JOIN categories c ON c.id=d.category_id
 WHERE i.id='legacy:dish:'||d.id
 UNION ALL
 SELECT i.id,i.cafe_id,d.id,i.stock,i.avg_cost,COALESCE(d.prep_station,c.prep_station)
 FROM ingredients i JOIN dish_variants v ON v.stock_ingredient_id=i.id JOIN dishes d ON d.id=v.dish_id JOIN categories c ON c.id=d.category_id
 WHERE i.id='legacy:variant:'||v.id
)
SELECT b.*,w.id AS default_warehouse_id,COALESCE(route.warehouse_id,w.id) AS warehouse_id
FROM bindings b JOIN warehouses w ON w.cafe_id=b.cafe_id AND w.is_default
LEFT JOIN station_warehouses route ON route.cafe_id=b.cafe_id AND route.station_id=b.station
WHERE NOT EXISTS(SELECT 1 FROM stock_movements m WHERE m.ingredient_id=b.ingredient_id AND m.source_id IS DISTINCT FROM 'migration:unified-warehouse');
-- Assign the newly migrated, previously global stock to its configured station.
-- These are migration allocation entries, not a claimed historical transfer.
INSERT INTO stock_movements(id,cafe_id,ingredient_id,warehouse_id,warehouse_key,type,source_type,source_id,before_stock,change,after_stock,cost_at_moment,comment,created_at)
SELECT 'migration-route-out:'||ingredient_id,cafe_id,ingredient_id,default_warehouse_id,'default','correction','manual','migration:legacy-routing',stock,-stock,0,avg_cost,'Распределение прежнего общего остатка на склад станции при переходе',NOW()
FROM legacy_stock_homes WHERE warehouse_id<>default_warehouse_id AND stock<>0;
INSERT INTO stock_movements(id,cafe_id,ingredient_id,warehouse_id,warehouse_key,type,source_type,source_id,before_stock,change,after_stock,cost_at_moment,comment,created_at)
SELECT 'migration-route-in:'||ingredient_id,cafe_id,ingredient_id,warehouse_id,warehouse_id,'correction','manual','migration:legacy-routing',0,stock,stock,avg_cost,'Начальный остаток готового товара на складе станции при переходе',NOW()+INTERVAL '1 microsecond'
FROM legacy_stock_homes WHERE warehouse_id<>default_warehouse_id AND stock<>0;
INSERT INTO warehouse_stock(cafe_id,warehouse_id,ingredient_id,stock,avg_cost)
SELECT cafe_id,warehouse_id,ingredient_id,stock,avg_cost FROM legacy_stock_homes WHERE warehouse_id<>default_warehouse_id
ON CONFLICT (warehouse_id,ingredient_id) DO UPDATE SET stock=EXCLUDED.stock,avg_cost=EXCLUDED.avg_cost;
UPDATE ingredients i SET stock=0 FROM legacy_stock_homes h WHERE i.id=h.ingredient_id AND h.warehouse_id<>h.default_warehouse_id;

-- Only direct parent lines were deducted by the old finished-goods mechanism.
-- Set components and recipes are deliberately not reconstructed from today's data.
CREATE TEMP TABLE legacy_open_allocations ON COMMIT DROP AS
SELECT oi.id AS item_id,oi.order_id,oi.quantity,oi.dish_id,oi.dish_variant_id,oi.created_at AS original_at,
 h.ingredient_id,h.cafe_id,h.warehouse_id,h.default_warehouse_id,h.stock,h.avg_cost,
 SUM(oi.quantity) OVER(PARTITION BY h.ingredient_id,h.warehouse_id) AS allocated,
 SUM(oi.quantity) OVER(PARTITION BY h.ingredient_id,h.warehouse_id ORDER BY oi.created_at,oi.id) AS cumulative,
 ROW_NUMBER() OVER(ORDER BY h.ingredient_id,h.warehouse_id,oi.created_at,oi.id) AS seq
FROM order_items oi JOIN orders o ON o.id=oi.order_id
JOIN legacy_stock_homes h ON h.ingredient_id=CASE WHEN oi.dish_variant_id IS NOT NULL THEN 'legacy:variant:'||oi.dish_variant_id ELSE 'legacy:dish:'||oi.dish_id END
WHERE oi.cafe_id=h.cafe_id AND o.cafe_id=h.cafe_id AND oi.quantity>0
 AND o.status NOT IN ('draft','paid','cancelled','rejected') AND o.closed_at IS NULL
 AND oi.status NOT IN ('cancelled','rejected')
 AND NOT EXISTS(SELECT 1 FROM stock_movements m WHERE m.source_type='order' AND m.source_id=o.id AND m.order_item_id=oi.id AND m.ingredient_id=h.ingredient_id AND m.type='sale');
INSERT INTO stock_movements(id,cafe_id,ingredient_id,warehouse_id,warehouse_key,type,source_type,source_id,before_stock,change,after_stock,cost_at_moment,comment,created_at)
SELECT 'migration-open-allocation:'||ingredient_id,cafe_id,ingredient_id,warehouse_id,
 CASE WHEN warehouse_id=default_warehouse_id THEN 'default' ELSE warehouse_id END,
 'correction','manual','migration:legacy-open-orders',stock,MAX(allocated),stock+MAX(allocated),avg_cost,
 'Начальная оценка уже списанного количества по незавершённым заказам; историческая цена неизвестна',NOW()+INTERVAL '2 microseconds'
FROM legacy_open_allocations GROUP BY ingredient_id,cafe_id,warehouse_id,default_warehouse_id,stock,avg_cost;
INSERT INTO stock_movements(id,cafe_id,ingredient_id,warehouse_id,warehouse_key,type,source_type,source_id,order_item_id,sale_line_id,sale_quantity,sale_cycle,before_stock,change,after_stock,cost_at_moment,recipe_snapshot,comment,created_at)
SELECT 'migration-open-sale:'||item_id||':'||ingredient_id,cafe_id,ingredient_id,warehouse_id,
 CASE WHEN warehouse_id=default_warehouse_id THEN 'default' ELSE warehouse_id END,
 'sale','order',order_id,item_id,item_id,quantity,0,stock+allocated-cumulative+quantity,-quantity,stock+allocated-cumulative,avg_cost,
 jsonb_build_object('kind','direct','legacyMigration',true,'costKnown',false,'dishId',dish_id,'variantId',dish_variant_id,'originalOrderItemCreatedAt',original_at,'warehouseAssignedAtMigration',true),
 'Перенос уже списанного готового товара открытого заказа; текущий остаток не изменяется',NOW()+(3+seq)*INTERVAL '1 microsecond'
FROM legacy_open_allocations;
COMMIT;
