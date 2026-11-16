ALTER TABLE "finance_accounts" ADD COLUMN "is_collection" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_collection_account_is_cash"
  CHECK (NOT "is_collection" OR ("type" = 'cash' AND NOT "is_default"));
CREATE UNIQUE INDEX "finance_accounts_one_collection_per_cafe"
  ON "finance_accounts" ("cafe_id") WHERE "is_collection";

ALTER TABLE "finance_categories" ADD COLUMN "show_on_pos" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "finance_entries" ADD COLUMN "pending_cash_shift" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_pending_entry_requires_shift"
  CHECK (NOT "pending_cash_shift" OR "cash_shift_id" IS NOT NULL);
