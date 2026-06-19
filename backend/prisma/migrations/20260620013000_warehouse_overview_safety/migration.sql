-- Warehouse overview and stock safety settings.
ALTER TABLE "settings"
ADD COLUMN IF NOT EXISTS "allow_negative_ingredient_stock" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "stock_movements"
ADD COLUMN IF NOT EXISTS "order_item_id" TEXT;

CREATE INDEX IF NOT EXISTS "stock_movements_order_item_id_idx"
ON "stock_movements"("order_item_id");

CREATE UNIQUE INDEX IF NOT EXISTS "stock_movements_order_item_once_key"
ON "stock_movements"("type", "source_type", "source_id", "order_item_id", "ingredient_id");
