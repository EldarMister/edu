CREATE TYPE "FinanceAccountType" AS ENUM ('cash', 'noncash');
CREATE TYPE "FinanceCategoryKind" AS ENUM ('income', 'expense');
CREATE TYPE "FinanceEntryKind" AS ENUM ('income', 'expense', 'transfer', 'sale', 'refund', 'salary', 'adjustment');

CREATE TABLE "finance_accounts" (
  "id" TEXT PRIMARY KEY,
  "cafe_id" TEXT NOT NULL REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "type" "FinanceAccountType" NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "opening_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "finance_accounts_cafe_id_id_key" ON "finance_accounts"("cafe_id", "id");
CREATE UNIQUE INDEX "finance_accounts_cafe_id_name_key" ON "finance_accounts"("cafe_id", "name");
CREATE UNIQUE INDEX "finance_accounts_default_type_key" ON "finance_accounts"("cafe_id", "type") WHERE "is_default";

CREATE TABLE "finance_categories" (
  "id" TEXT PRIMARY KEY,
  "cafe_id" TEXT NOT NULL REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "kind" "FinanceCategoryKind" NOT NULL,
  "user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "position_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "finance_categories_cafe_id_id_key" ON "finance_categories"("cafe_id", "id");
CREATE UNIQUE INDEX "finance_categories_cafe_id_kind_name_key" ON "finance_categories"("cafe_id", "kind", "name");

CREATE TABLE "salary_accruals" (
  "id" TEXT PRIMARY KEY,
  "cafe_id" TEXT NOT NULL REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL,
  "month" TEXT NOT NULL CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  "amount" DECIMAL(18,2) NOT NULL CHECK ("amount" > 0),
  "note" TEXT,
  "actor_id" TEXT NOT NULL,
  "request_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "salary_accruals_cafe_id_id_key" ON "salary_accruals"("cafe_id", "id");
CREATE UNIQUE INDEX "salary_accruals_cafe_id_request_key_key" ON "salary_accruals"("cafe_id", "request_key");
CREATE INDEX "salary_accruals_cafe_id_month_idx" ON "salary_accruals"("cafe_id", "month");

CREATE TABLE "finance_entries" (
  "id" TEXT PRIMARY KEY,
  "cafe_id" TEXT NOT NULL REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "account_id" TEXT NOT NULL,
  "kind" "FinanceEntryKind" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "category_id" TEXT,
  "counterparty_account_id" TEXT,
  "salary_accrual_id" TEXT,
  "cash_shift_id" TEXT,
  "actor_id" TEXT,
  "source_key" TEXT,
  "note" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_entries_cafe_id_account_id_fkey" FOREIGN KEY ("cafe_id", "account_id") REFERENCES "finance_accounts"("cafe_id", "id") ON UPDATE CASCADE,
  CONSTRAINT "finance_entries_cafe_id_counterparty_account_id_fkey" FOREIGN KEY ("cafe_id", "counterparty_account_id") REFERENCES "finance_accounts"("cafe_id", "id") ON UPDATE CASCADE,
  CONSTRAINT "finance_entries_cafe_id_category_id_fkey" FOREIGN KEY ("cafe_id", "category_id") REFERENCES "finance_categories"("cafe_id", "id") ON UPDATE CASCADE,
  CONSTRAINT "finance_entries_cafe_id_salary_accrual_id_fkey" FOREIGN KEY ("cafe_id", "salary_accrual_id") REFERENCES "salary_accruals"("cafe_id", "id") ON UPDATE CASCADE,
  CONSTRAINT "finance_entries_amount_check" CHECK (
    ("kind" IN ('income','sale') AND "amount" > 0) OR
    ("kind" IN ('expense','refund','salary') AND "amount" < 0) OR
    ("kind" IN ('transfer','adjustment') AND "amount" <> 0)
  ),
  CONSTRAINT "finance_entries_transfer_check" CHECK (
    ("kind" = 'transfer' AND "counterparty_account_id" IS NOT NULL AND "account_id" <> "counterparty_account_id")
    OR ("kind" <> 'transfer' AND "counterparty_account_id" IS NULL)
  ),
  CONSTRAINT "finance_entries_salary_check" CHECK (("kind" = 'salary') = ("salary_accrual_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "finance_entries_cafe_id_source_key_key" ON "finance_entries"("cafe_id", "source_key");
CREATE INDEX "finance_entries_cafe_id_occurred_at_idx" ON "finance_entries"("cafe_id", "occurred_at");
CREATE INDEX "finance_entries_cafe_id_account_id_occurred_at_idx" ON "finance_entries"("cafe_id", "account_id", "occurred_at");
CREATE INDEX "finance_entries_cafe_id_salary_accrual_id_idx" ON "finance_entries"("cafe_id", "salary_accrual_id");
CREATE INDEX "finance_entries_cafe_id_cash_shift_id_idx" ON "finance_entries"("cafe_id", "cash_shift_id");

INSERT INTO "finance_accounts" ("id", "cafe_id", "name", "type", "is_default")
SELECT 'finance:cash:' || "id", "id", 'Касса', 'cash', true FROM "cafes"
UNION ALL
SELECT 'finance:noncash:' || "id", "id", 'Расчётный счёт', 'noncash'::"FinanceAccountType", true FROM "cafes";
