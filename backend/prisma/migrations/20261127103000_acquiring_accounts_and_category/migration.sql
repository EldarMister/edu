ALTER TABLE "settings"
    ADD COLUMN "card_settlement_account_id" TEXT,
    ADD COLUMN "qr_settlement_account_id" TEXT;

ALTER TABLE "cash_shifts"
    ADD COLUMN "card_settlement_account_id" TEXT,
    ADD COLUMN "qr_settlement_account_id" TEXT;

ALTER TABLE "finance_categories" ADD COLUMN "system_key" TEXT;
CREATE UNIQUE INDEX "finance_categories_cafe_id_system_key_key" ON "finance_categories"("cafe_id", "system_key");

-- Keep the category already used for automatic fees, including any rename.
WITH last_fee_category AS (
    SELECT DISTINCT ON (entry."cafe_id") entry."cafe_id", entry."category_id"
    FROM "finance_entries" entry
    JOIN "finance_categories" category ON category."cafe_id" = entry."cafe_id" AND category."id" = entry."category_id"
    WHERE entry."source_key" LIKE 'cash-processing-fee:%' AND category."kind" = 'expense'
    ORDER BY entry."cafe_id", entry."occurred_at" DESC, entry."id" DESC
)
UPDATE "finance_categories" category
SET "system_key" = 'payment-processing-fees', "show_in_profit_loss" = TRUE
FROM last_fee_category current
WHERE category."cafe_id" = current."cafe_id" AND category."id" = current."category_id";
