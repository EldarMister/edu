ALTER TABLE "settings" ADD COLUMN "cash_shifts_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "cash_shifts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "cafe_id" TEXT NOT NULL REFERENCES "cafes"("id") ON DELETE CASCADE,
  "account_id" TEXT NOT NULL REFERENCES "finance_accounts"("id") ON DELETE RESTRICT,
  "opened_by_id" TEXT NOT NULL,
  "closed_by_id" TEXT,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  "opening_amount" DECIMAL(14,2) NOT NULL CHECK ("opening_amount" >= 0),
  "expected_amount" DECIMAL(14,2),
  "actual_amount" DECIMAL(14,2) CHECK ("actual_amount" >= 0),
  "difference" DECIMAL(14,2)
);
CREATE INDEX "cash_shifts_cafe_id_opened_at_idx" ON "cash_shifts" ("cafe_id", "opened_at");
CREATE UNIQUE INDEX "cash_shifts_one_open_per_cafe" ON "cash_shifts" ("cafe_id") WHERE "closed_at" IS NULL;
