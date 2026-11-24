ALTER TABLE "purchases"
  ADD COLUMN "settlement_known_at" TIMESTAMP(3),
  ADD COLUMN "settlement_opening_paid" DECIMAL(12,2);

ALTER TABLE "finance_entries" ADD COLUMN "purchase_id" TEXT;

CREATE UNIQUE INDEX "purchases_cafe_id_id_key" ON "purchases"("cafe_id", "id");
CREATE INDEX "finance_entries_cafe_id_purchase_id_idx" ON "finance_entries"("cafe_id", "purchase_id");

ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_cafe_id_purchase_id_fkey"
  FOREIGN KEY ("cafe_id", "purchase_id") REFERENCES "purchases"("cafe_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
