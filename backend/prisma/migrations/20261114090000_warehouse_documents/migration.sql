ALTER TYPE "StockMovementType" ADD VALUE 'inventory';
ALTER TYPE "StockMovementType" ADD VALUE 'writeoff';
ALTER TYPE "StockMovementSource" ADD VALUE 'inventory';
ALTER TYPE "StockMovementSource" ADD VALUE 'writeoff';

CREATE TYPE "WarehouseDocumentKind" AS ENUM ('inventory', 'writeoff');
CREATE TYPE "WarehouseInventoryMode" AS ENUM ('full', 'partial');
CREATE TYPE "WarehouseDocumentStatus" AS ENUM ('draft', 'submitted', 'posted');
CREATE TYPE "WarehouseWriteoffReason" AS ENUM ('spoilage', 'expired', 'damage', 'staff_meal', 'other');

CREATE TABLE "warehouse_documents" (
  "id" TEXT PRIMARY KEY,
  "cafe_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "kind" "WarehouseDocumentKind" NOT NULL,
  "mode" "WarehouseInventoryMode",
  "reason" "WarehouseWriteoffReason",
  "note" TEXT,
  "status" "WarehouseDocumentStatus" NOT NULL DEFAULT 'draft',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMP(3),
  "posted_at" TIMESTAMP(3),
  "created_by_id" TEXT NOT NULL,
  "created_by_name" TEXT NOT NULL,
  "submitted_by_id" TEXT,
  "submitted_by_name" TEXT,
  "posted_by_id" TEXT,
  "posted_by_name" TEXT,
  CONSTRAINT "warehouse_documents_warehouse_fk" FOREIGN KEY ("cafe_id", "warehouse_id")
    REFERENCES "warehouses"("cafe_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "warehouse_documents_mode_check" CHECK (
    ("kind" = 'inventory' AND "mode" IS NOT NULL AND "reason" IS NULL)
    OR ("kind" = 'writeoff' AND "mode" IS NULL)
  )
);
CREATE UNIQUE INDEX "warehouse_documents_cafe_id_id_key" ON "warehouse_documents"("cafe_id", "id");
CREATE INDEX "warehouse_documents_cafe_id_warehouse_id_kind_created_at_idx"
  ON "warehouse_documents"("cafe_id", "warehouse_id", "kind", "created_at");

CREATE TABLE "warehouse_document_items" (
  "cafe_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "ingredient_id" TEXT NOT NULL REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "expected" DECIMAL(14,3),
  "quantity" DECIMAL(14,3),
  "difference" DECIMAL(14,3),
  "unit_cost" DECIMAL(20,8),
  "inventory_generation" INTEGER,
  PRIMARY KEY ("document_id", "ingredient_id"),
  CONSTRAINT "warehouse_document_items_document_fk" FOREIGN KEY ("cafe_id", "document_id")
    REFERENCES "warehouse_documents"("cafe_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "warehouse_document_items_cafe_id_ingredient_id_idx"
  ON "warehouse_document_items"("cafe_id", "ingredient_id");
