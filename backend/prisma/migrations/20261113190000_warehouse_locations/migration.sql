CREATE TABLE "warehouses" (
  "id" TEXT PRIMARY KEY,
  "cafe_id" TEXT NOT NULL REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX "warehouses_cafe_id_name_key" ON "warehouses"("cafe_id", "name");
CREATE UNIQUE INDEX "warehouses_cafe_id_id_key" ON "warehouses"("cafe_id", "id");
CREATE UNIQUE INDEX "warehouses_one_default_per_cafe" ON "warehouses"("cafe_id") WHERE "is_default";

INSERT INTO "warehouses" ("id", "cafe_id", "name", "is_default")
SELECT 'warehouse:default:' || "id", "id", 'Общий склад', true FROM "cafes";

CREATE TABLE "warehouse_stock" (
  "cafe_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "ingredient_id" TEXT NOT NULL REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "stock" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "avg_cost" DECIMAL(20,8) NOT NULL DEFAULT 0,
  PRIMARY KEY ("warehouse_id", "ingredient_id"),
  FOREIGN KEY ("cafe_id", "warehouse_id") REFERENCES "warehouses"("cafe_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "warehouse_stock_cafe_id_ingredient_id_idx" ON "warehouse_stock"("cafe_id", "ingredient_id");

CREATE TABLE "station_warehouses" (
  "cafe_id" TEXT NOT NULL,
  "station_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  PRIMARY KEY ("cafe_id", "station_id"),
  FOREIGN KEY ("cafe_id", "warehouse_id") REFERENCES "warehouses"("cafe_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "purchases" ADD COLUMN "warehouse_id" TEXT REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "purchases_cafe_id_warehouse_id_idx" ON "purchases"("cafe_id", "warehouse_id");
ALTER TABLE "stock_movements"
  ADD COLUMN "warehouse_id" TEXT REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "sale_quantity" INTEGER,
  ADD COLUMN "sale_cycle" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sale_line_id" TEXT;
DROP INDEX IF EXISTS "stock_movements_order_item_once_key";
CREATE UNIQUE INDEX "stock_movements_order_item_cycle_key"
  ON "stock_movements"("type", "source_type", "source_id", "order_item_id", "ingredient_id", "sale_cycle");
CREATE INDEX "stock_movements_source_id_sale_line_id_idx" ON "stock_movements"("source_id", "sale_line_id");
CREATE INDEX "stock_movements_cafe_id_warehouse_id_created_at_idx"
  ON "stock_movements"("cafe_id", "warehouse_id", "created_at");
ALTER TABLE "recipe_items" ADD COLUMN "from_common_warehouse" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ingredients" ADD COLUMN "is_prepared" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "preparation_recipes" (
  "cafe_id" TEXT NOT NULL,
  "ingredient_id" TEXT PRIMARY KEY REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "output_amount" DECIMAL(14,3) NOT NULL CHECK ("output_amount" > 0),
  "output_unit" TEXT NOT NULL
);
CREATE INDEX "preparation_recipes_cafe_id_idx" ON "preparation_recipes"("cafe_id");

CREATE TABLE "preparation_recipe_items" (
  "cafe_id" TEXT NOT NULL,
  "recipe_id" TEXT NOT NULL REFERENCES "preparation_recipes"("ingredient_id") ON DELETE CASCADE ON UPDATE CASCADE,
  "ingredient_id" TEXT NOT NULL REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount" DECIMAL(14,3) NOT NULL CHECK ("amount" > 0),
  "unit" TEXT NOT NULL,
  PRIMARY KEY ("recipe_id", "ingredient_id")
);
CREATE INDEX "preparation_recipe_items_cafe_id_ingredient_id_idx" ON "preparation_recipe_items"("cafe_id", "ingredient_id");
