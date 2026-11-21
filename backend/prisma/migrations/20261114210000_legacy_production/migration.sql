BEGIN;
-- Reconstruct only the exact journal shape emitted by the legacy production service.
-- Quantities, valuation, timestamps and original comments remain untouched.
-- Ambiguous/incomplete manual groups remain in the journal without an invented document.
CREATE TEMP TABLE legacy_production_candidates ON COMMIT DROP AS
SELECT m.cafe_id, m.source_id,
       MAX(m.ingredient_id) FILTER (WHERE m.change > 0) AS ingredient_id,
       MAX(m.change) FILTER (WHERE m.change > 0) AS output_quantity,
       SUM(-m.change * m.cost_at_moment) FILTER (WHERE m.change < 0) AS total_cost,
       MIN(m.created_at) AS produced_at,
       COALESCE(MAX(m.warehouse_id), (SELECT w.id FROM warehouses w WHERE w.cafe_id = m.cafe_id AND w.is_default LIMIT 1)) AS warehouse_id
FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id AND i.cafe_id = m.cafe_id
WHERE m.source_id IS NOT NULL AND m.cafe_id IS NOT NULL
GROUP BY m.cafe_id, m.source_id
HAVING COUNT(*) FILTER (WHERE m.change > 0) = 1
   AND COUNT(*) FILTER (WHERE m.change < 0) >= 1
   AND BOOL_AND(m.type = 'correction' AND m.source_type = 'manual')
   AND BOOL_AND((m.change > 0 AND i.is_prepared AND m.comment LIKE 'Выпуск партии «%»')
             OR (m.change < 0 AND m.comment LIKE 'Сырьё для партии «%»'))
   AND COUNT(DISTINCT COALESCE(m.warehouse_id, '__main__')) = 1
   AND COUNT(*) = COUNT(DISTINCT m.ingredient_id)
   AND ABS(SUM(m.change * m.cost_at_moment)) < 0.02
   AND NOT EXISTS (SELECT 1 FROM stock_movements other WHERE other.source_id = m.source_id AND other.cafe_id IS DISTINCT FROM m.cafe_id);

INSERT INTO preparation_batches (id,cafe_id,warehouse_id,ingredient_id,planned_quantity,actual_quantity,total_cost,items,produced_at,request_key)
SELECT c.source_id,c.cafe_id,c.warehouse_id,c.ingredient_id,c.output_quantity,c.output_quantity,ROUND(c.total_cost,2),
  jsonb_build_object('legacy',true,'legacySourceType','manual','legacyMovementType','correction',
    'historyNote','Документ восстановлен из исходного журнала; состав и стоимость сохранены на дату выпуска.',
    'actual',(SELECT jsonb_agg(jsonb_build_object('ingredientId',m.ingredient_id,'name',i.name,'amount',(-m.change)::text,
       'unit',i.display_unit,'quantity',CASE WHEN i.display_unit IN ('kg','l') THEN -m.change / 1000 ELSE -m.change END,
       'cost',(-m.change*m.cost_at_moment)::text,'costAtMoment',m.cost_at_moment::text) ORDER BY m.ingredient_id)
       FROM stock_movements m JOIN ingredients i ON i.id=m.ingredient_id
       WHERE m.source_id=c.source_id AND m.cafe_id=c.cafe_id AND m.change<0)),
  c.produced_at,'legacy:'||c.source_id
FROM legacy_production_candidates c
WHERE c.warehouse_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preparation_batches b WHERE b.id=c.source_id);

UPDATE stock_movements m SET source_type='production',
 recipe_snapshot=COALESCE(m.recipe_snapshot,'{}'::jsonb)||jsonb_build_object('legacyProduction',true,'legacySourceType','manual','legacyMovementType','correction')
FROM legacy_production_candidates c JOIN preparation_batches b ON b.id=c.source_id AND b.cafe_id=c.cafe_id
WHERE m.source_id=c.source_id AND m.cafe_id=c.cafe_id;

COMMIT;
