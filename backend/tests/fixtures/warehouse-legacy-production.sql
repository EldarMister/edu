-- Load after warehouse-legacy.sql and before unified warehouse migrations, in a local test DB only.
INSERT INTO ingredients (id,cafe_id,name,unit_type,display_unit,stock,avg_cost,is_prepared,updated_at) VALUES
 ('migration-flour','warehouse-migration-fixture','Legacy flour','mass','kg',8000,0.1,false,NOW()),
 ('migration-dough','warehouse-migration-fixture','Legacy dough','mass','kg',5000,0.04,true,NOW());
INSERT INTO stock_movements (id,cafe_id,ingredient_id,type,source_type,source_id,before_stock,change,after_stock,cost_at_moment,comment) VALUES
 ('migration-prod-raw','warehouse-migration-fixture','migration-flour','correction','manual','migration-production-batch',10000,-2000,8000,0.1,'Сырьё для партии «Legacy dough»'),
 ('migration-prod-output','warehouse-migration-fixture','migration-dough','correction','manual','migration-production-batch',0,5000,5000,0.04,'Выпуск партии «Legacy dough»'),
 ('migration-prod-incomplete','warehouse-migration-fixture','migration-flour','correction','manual','migration-production-incomplete',8000,0,8000,0.1,'Неполная ручная запись');
