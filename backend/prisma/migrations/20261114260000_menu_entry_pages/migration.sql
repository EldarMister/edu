ALTER TABLE "dishes" ADD COLUMN "catalog_kind" TEXT NOT NULL DEFAULT 'recipe';
ALTER TABLE "dishes" ADD COLUMN "menu_create_key" TEXT;
UPDATE "dishes" d SET "catalog_kind" = 'goods'
WHERE NOT d."is_set" AND (d."stock_ingredient_id" IS NOT NULL OR EXISTS (
  SELECT 1 FROM "dish_variants" v WHERE v."dish_id" = d.id AND v."stock_ingredient_id" IS NOT NULL
));
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_catalog_kind_check" CHECK ("catalog_kind" IN ('goods', 'recipe'));
CREATE UNIQUE INDEX "dishes_menu_create_key_key" ON "dishes"("menu_create_key");
