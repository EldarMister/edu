ALTER TABLE "finance_entries" ADD COLUMN "deal_date" DATE;
ALTER TABLE "finance_categories" ADD COLUMN "show_in_profit_loss" BOOLEAN NOT NULL DEFAULT true;
