ALTER TABLE "settings" ADD COLUMN "cash_handover_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shift_cash_reports" ADD COLUMN "cash_received_at" TIMESTAMP(3);
ALTER TABLE "finance_entries"
  ADD COLUMN "cash_custodian_id" TEXT,
  ADD COLUMN "cash_custody_day" DATE,
  ADD CONSTRAINT "finance_entries_cash_custody_check" CHECK (
    ("cash_custodian_id" IS NULL AND "cash_custody_day" IS NULL) OR
    ("cash_custodian_id" IS NOT NULL AND "cash_custody_day" IS NOT NULL AND
      "cash_shift_id" IS NULL AND NOT "pending_cash_shift" AND "kind" IN ('sale', 'refund'))
  );
CREATE INDEX "finance_entries_cash_custody_idx" ON "finance_entries"("cafe_id", "cash_custody_day", "cash_custodian_id");
