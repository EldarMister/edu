ALTER TABLE "settings" ADD COLUMN "expense_writeoff_reasons" "WarehouseWriteoffReason"[]
    NOT NULL DEFAULT ARRAY[]::"WarehouseWriteoffReason"[];
