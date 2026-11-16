ALTER TYPE "FinanceCategoryKind" ADD VALUE 'both';

ALTER TABLE "finance_categories" ADD COLUMN "parent_id" TEXT;

CREATE INDEX "finance_categories_cafe_id_parent_id_idx" ON "finance_categories"("cafe_id", "parent_id");

ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_cafe_id_parent_id_fkey"
  FOREIGN KEY ("cafe_id", "parent_id") REFERENCES "finance_categories"("cafe_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
