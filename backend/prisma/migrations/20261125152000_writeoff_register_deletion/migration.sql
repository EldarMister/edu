ALTER TABLE "settings" ADD COLUMN "archived_builtin_writeoff_reasons" "WarehouseWriteoffReason"[]
  NOT NULL DEFAULT ARRAY[]::"WarehouseWriteoffReason"[];

ALTER TABLE "warehouse_documents" ADD COLUMN "deleted_at" TIMESTAMP(3);
