ALTER TABLE "recipe_items"
  ADD COLUMN "processing_stages" JSONB,
  ADD COLUMN "processing_basis" TEXT,
  ALTER COLUMN "loss_percent" TYPE DECIMAL(20,2);

ALTER TABLE "preparation_recipe_items"
  ADD COLUMN "processing_stages" JSONB,
  ADD COLUMN "processing_basis" TEXT,
  ALTER COLUMN "loss_percent" TYPE DECIMAL(20,2);
