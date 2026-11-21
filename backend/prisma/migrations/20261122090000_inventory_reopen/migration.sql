ALTER TABLE "warehouse_documents"
  ADD COLUMN "reopened_at" TIMESTAMP(3),
  ADD CONSTRAINT "warehouse_documents_reopened_inventory_check"
    CHECK ("reopened_at" IS NULL OR ("kind" = 'inventory' AND "status" = 'draft' AND "posted_at" IS NOT NULL));

ALTER TABLE "warehouse_document_items"
  ADD COLUMN "reopened_quantity" DECIMAL(14,3);

CREATE UNIQUE INDEX "warehouse_documents_one_reopened_inventory"
  ON "warehouse_documents" ("cafe_id", "warehouse_id")
  WHERE "reopened_at" IS NOT NULL;
