-- Representative pre-migration data. Only load into an isolated local test database.
INSERT INTO cafes (id,name,updated_at) VALUES ('warehouse-migration-fixture','Migration fixture',NOW());
INSERT INTO categories (id,cafe_id,name,updated_at) VALUES ('migration-drinks','warehouse-migration-fixture','Drinks',NOW());
INSERT INTO dishes (id,cafe_id,category_id,name,price,track_inventory,stock,updated_at) VALUES
 ('migration-cola','warehouse-migration-fixture','migration-drinks','Cola',90,true,24,NOW()),
 ('migration-sizes','warehouse-migration-fixture','migration-drinks','Water',60,true,0,NOW()),
 ('migration-recipe','warehouse-migration-fixture','migration-drinks','Lemonade',100,true,10,NOW());
INSERT INTO dish_variants (id,cafe_id,dish_id,name,price,stock) VALUES
 ('migration-small','warehouse-migration-fixture','migration-sizes','Small',60,12),
 ('migration-large','warehouse-migration-fixture','migration-sizes','Large',90,7);
INSERT INTO ingredients (id,cafe_id,name,unit_type,display_unit,stock,avg_cost,updated_at) VALUES
 ('migration-syrup','warehouse-migration-fixture','Syrup','volume','l',5000,0.2,NOW());
INSERT INTO recipe_items (id,cafe_id,dish_id,ingredient_id,amount,amount_unit,updated_at) VALUES
 ('migration-recipe-line','warehouse-migration-fixture','migration-recipe','migration-syrup',200,'ml',NOW());
