CREATE TABLE "writeoff_reasons" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "cafe_id" TEXT NOT NULL REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "expense" BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX "writeoff_reasons_cafe_id_id_key" ON "writeoff_reasons"("cafe_id", "id");
CREATE UNIQUE INDEX "writeoff_reasons_cafe_id_normalized_name_key" ON "writeoff_reasons"("cafe_id", "normalized_name");
ALTER TABLE "warehouse_documents" ADD COLUMN "writeoff_reason_id" TEXT;
ALTER TABLE "warehouse_documents" ADD CONSTRAINT "warehouse_documents_cafe_id_writeoff_reason_id_fkey"
  FOREIGN KEY ("cafe_id", "writeoff_reason_id") REFERENCES "writeoff_reasons"("cafe_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "warehouse_documents" ADD CONSTRAINT "warehouse_documents_writeoff_reason_check"
  CHECK ("writeoff_reason_id" IS NULL OR ("kind" = 'writeoff' AND "reason" IS NULL));
CREATE INDEX "warehouse_documents_cafe_id_writeoff_reason_id_idx" ON "warehouse_documents"("cafe_id", "writeoff_reason_id");
