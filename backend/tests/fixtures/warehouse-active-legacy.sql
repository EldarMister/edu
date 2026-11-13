-- Load AFTER warehouse-legacy.sql and BEFORE the unified warehouse migrations.
INSERT INTO warehouses(id,cafe_id,name,is_default) VALUES
 ('migration-main','warehouse-migration-fixture','Основной склад',true),
 ('migration-bar','warehouse-migration-fixture','Бар',false);
UPDATE categories SET prep_station='bar' WHERE id='migration-drinks';
INSERT INTO station_warehouses(cafe_id,station_id,warehouse_id) VALUES('warehouse-migration-fixture','bar','migration-bar');
INSERT INTO halls(id,cafe_id,name,updated_at) VALUES('migration-hall','warehouse-migration-fixture','Зал',NOW());
INSERT INTO tables(id,cafe_id,hall_id,number,qr_token,updated_at) VALUES('migration-table','warehouse-migration-fixture','migration-hall',1,'migration-qr',NOW());
INSERT INTO orders(id,cafe_id,order_number,table_id,status,updated_at) VALUES
 ('migration-active-order','warehouse-migration-fixture','migration-active','migration-table','sent_to_kitchen',NOW()),
 ('migration-paid-order','warehouse-migration-fixture','migration-paid','migration-table','paid',NOW()),
 ('migration-draft-order','warehouse-migration-fixture','migration-draft','migration-table','draft',NOW());
INSERT INTO order_items(id,cafe_id,order_id,dish_id,dish_variant_id,dish_name_snapshot,price_snapshot,quantity,final_price,status,prep_station,updated_at) VALUES
 ('migration-open-cola','warehouse-migration-fixture','migration-active-order','migration-cola',NULL,'Cola',90,3,270,'new','bar',NOW()),
 ('migration-ready-cola','warehouse-migration-fixture','migration-active-order','migration-cola',NULL,'Cola',90,1,90,'ready','bar',NOW()),
 ('migration-open-variant','warehouse-migration-fixture','migration-active-order','migration-sizes','migration-small','Water',60,2,120,'new','bar',NOW()),
 ('migration-paid-variant','warehouse-migration-fixture','migration-paid-order','migration-sizes','migration-large','Water',90,2,180,'served','bar',NOW()),
 ('migration-draft-cola','warehouse-migration-fixture','migration-draft-order','migration-cola',NULL,'Cola',90,1,90,'new','bar',NOW());
