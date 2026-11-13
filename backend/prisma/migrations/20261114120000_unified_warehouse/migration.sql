-- CreateEnum
CREATE TYPE "IngredientKind" AS ENUM ('raw', 'beverage', 'goods', 'preparation', 'prepared_dish', 'consumable');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'transfer';
ALTER TYPE "StockMovementType" ADD VALUE 'supplier_return';
ALTER TYPE "StockMovementType" ADD VALUE 'production';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementSource" ADD VALUE 'transfer';
ALTER TYPE "StockMovementSource" ADD VALUE 'supplier_return';
ALTER TYPE "StockMovementSource" ADD VALUE 'production';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WarehouseDocumentKind" ADD VALUE 'transfer';
ALTER TYPE "WarehouseDocumentKind" ADD VALUE 'supplier_return';

-- AlterEnum
ALTER TYPE "WarehouseDocumentStatus" ADD VALUE 'reversed';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WarehouseWriteoffReason" ADD VALUE 'tasting';
ALTER TYPE "WarehouseWriteoffReason" ADD VALUE 'household';

-- DropIndex
DROP INDEX "stock_movements_order_item_cycle_key";

-- AlterTable
ALTER TABLE "dishes" ADD COLUMN     "recipe_metadata" JSONB,
ADD COLUMN     "recipe_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "stock_amount" DECIMAL(14,3) NOT NULL DEFAULT 1,
ADD COLUMN     "stock_ingredient_id" TEXT;

-- AlterTable
ALTER TABLE "dish_variants" ADD COLUMN     "stock_amount" DECIMAL(14,3) NOT NULL DEFAULT 1,
ADD COLUMN     "stock_ingredient_id" TEXT;

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "kind" "IngredientKind" NOT NULL DEFAULT 'raw',
ADD COLUMN     "preparation_mode" TEXT NOT NULL DEFAULT 'stocked',
ADD COLUMN     "purchase_factor" DECIMAL(14,6),
ADD COLUMN     "purchase_unit" TEXT,
ADD COLUMN     "supplier" TEXT;

-- AlterTable
ALTER TABLE "recipe_items" ADD COLUMN     "loss_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "net_amount" DECIMAL(14,3),
ADD COLUMN     "variant_amounts" JSONB,
ADD COLUMN     "warehouse_id" TEXT;

-- AlterTable
ALTER TABLE "warehouse_documents" ADD COLUMN     "destination_warehouse_id" TEXT,
ADD COLUMN     "request_key" TEXT,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "reversed_by_id" TEXT,
ADD COLUMN     "reversed_by_name" TEXT,
ADD COLUMN     "source_purchase_id" TEXT;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "attachments" JSONB,
ADD COLUMN     "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "actor_id" TEXT,
ADD COLUMN     "actor_name" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "recipe_snapshot" JSONB,
ADD COLUMN     "warehouse_key" TEXT NOT NULL DEFAULT 'default';

-- CreateTable
CREATE TABLE "preparation_batches" (
    "id" TEXT NOT NULL,
    "cafe_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "planned_quantity" DECIMAL(14,3) NOT NULL,
    "actual_quantity" DECIMAL(14,3) NOT NULL,
    "total_cost" DECIMAL(12,2) NOT NULL,
    "items" JSONB NOT NULL,
    "produced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "batch_number" TEXT,
    "request_key" TEXT NOT NULL,

    CONSTRAINT "preparation_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "preparation_batches_cafe_id_ingredient_id_produced_at_idx" ON "preparation_batches"("cafe_id", "ingredient_id", "produced_at");

-- CreateIndex
CREATE UNIQUE INDEX "preparation_batches_cafe_id_request_key_key" ON "preparation_batches"("cafe_id", "request_key");

-- CreateIndex
CREATE INDEX "ingredients_cafe_id_kind_idx" ON "ingredients"("cafe_id", "kind");

-- CreateIndex
CREATE INDEX "ingredients_cafe_id_barcode_idx" ON "ingredients"("cafe_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_documents_cafe_id_request_key_key" ON "warehouse_documents"("cafe_id", "request_key");

-- Preserve historical warehouse identity before widening the order idempotency key.
UPDATE stock_movements m SET warehouse_key = CASE WHEN w.is_default THEN 'default' ELSE COALESCE(m.warehouse_id, 'default') END
FROM warehouses w WHERE w.id = m.warehouse_id;
UPDATE ingredients SET kind = 'preparation' WHERE is_prepared = true;

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_order_item_cycle_key" ON "stock_movements"("type", "source_type", "source_id", "order_item_id", "ingredient_id", "sale_cycle", "warehouse_key");

-- AddForeignKey
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_stock_ingredient_id_fkey" FOREIGN KEY ("stock_ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dish_variants" ADD CONSTRAINT "dish_variants_stock_ingredient_id_fkey" FOREIGN KEY ("stock_ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve legacy finished-goods balances in the single catalog. Existing recipe
-- dishes keep their ingredient accounting and are never converted into raw stock.
INSERT INTO ingredients (id,cafe_id,name,unit_type,display_unit,stock,avg_cost,low_stock_threshold,is_active,is_prepared,kind,created_at,updated_at)
SELECT 'legacy:dish:'||d.id,d.cafe_id,d.name,'count','pcs',d.stock,0,0,d.is_active,false,'goods',NOW(),NOW()
FROM dishes d WHERE d.track_inventory AND d.stock IS NOT NULL AND d.cafe_id IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM recipe_items r WHERE r.dish_id=d.id)
AND NOT EXISTS (SELECT 1 FROM dish_variants v WHERE v.dish_id=d.id AND v.stock IS NOT NULL);
UPDATE dishes d SET stock_ingredient_id='legacy:dish:'||d.id
WHERE EXISTS (SELECT 1 FROM ingredients i WHERE i.id='legacy:dish:'||d.id);
INSERT INTO ingredients (id,cafe_id,name,unit_type,display_unit,stock,avg_cost,low_stock_threshold,is_active,is_prepared,kind,created_at,updated_at)
SELECT 'legacy:variant:'||v.id,d.cafe_id,d.name||' · '||v.name,'count','pcs',v.stock,0,0,d.is_active,false,'goods',NOW(),NOW()
FROM dish_variants v JOIN dishes d ON d.id=v.dish_id
WHERE d.track_inventory AND v.stock IS NOT NULL AND d.cafe_id IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM recipe_items r WHERE r.dish_id=d.id);
UPDATE dish_variants v SET stock_ingredient_id='legacy:variant:'||v.id
WHERE EXISTS (SELECT 1 FROM ingredients i WHERE i.id='legacy:variant:'||v.id);
INSERT INTO stock_movements (id,cafe_id,ingredient_id,type,source_type,source_id,before_stock,change,after_stock,cost_at_moment,comment,created_at)
SELECT 'opening:'||i.id,i.cafe_id,i.id,'correction','manual','migration:unified-warehouse',0,i.stock,i.stock,0,'Начальный остаток из прежнего учёта готовых товаров',NOW()
FROM ingredients i WHERE i.id LIKE 'legacy:dish:%' OR i.id LIKE 'legacy:variant:%';
-- Original dish/variant stock columns intentionally remain as rollback evidence.
