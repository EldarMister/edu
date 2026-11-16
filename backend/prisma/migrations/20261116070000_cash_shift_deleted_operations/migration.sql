CREATE TABLE "cash_shift_deleted_operations" (
    "id" TEXT NOT NULL,
    "cafe_id" TEXT NOT NULL,
    "cash_shift_id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "kind" "FinanceEntryKind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "category" TEXT,
    "note" TEXT,
    "actor_name" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "deleted_by_id" TEXT NOT NULL,
    "deleted_by_name" TEXT,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_shift_deleted_operations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_shift_deleted_operations_cash_shift_id_fkey"
        FOREIGN KEY ("cash_shift_id") REFERENCES "cash_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "cash_shift_deleted_operations_cafe_id_source_key_key"
    ON "cash_shift_deleted_operations"("cafe_id", "source_key");
CREATE INDEX "cash_shift_deleted_operations_shift_history_idx"
    ON "cash_shift_deleted_operations"("cafe_id", "cash_shift_id", "occurred_at");
