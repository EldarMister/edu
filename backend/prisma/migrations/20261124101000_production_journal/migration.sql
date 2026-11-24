ALTER TABLE "preparation_batches" ADD COLUMN "comment" TEXT;
CREATE INDEX "preparation_batches_cafe_id_produced_at_idx" ON "preparation_batches"("cafe_id", "produced_at");
