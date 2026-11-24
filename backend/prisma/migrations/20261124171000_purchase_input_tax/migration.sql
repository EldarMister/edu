ALTER TABLE "purchase_items"
  ADD COLUMN "tax_id" TEXT,
  ADD COLUMN "tax_name" TEXT,
  ADD COLUMN "tax_rate" DECIMAL(5,2),
  ADD COLUMN "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

