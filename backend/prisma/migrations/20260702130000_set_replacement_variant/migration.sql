-- Store the selected variant for a replacement dish inside a set component.
ALTER TABLE "order_item_set_components"
  ADD COLUMN "final_variant_id" TEXT,
  ADD COLUMN "final_variant_name_snapshot" TEXT;

CREATE INDEX "order_item_set_components_final_variant_id_idx"
  ON "order_item_set_components"("final_variant_id");

ALTER TABLE "order_item_set_components"
  ADD CONSTRAINT "order_item_set_components_final_variant_id_fkey"
  FOREIGN KEY ("final_variant_id") REFERENCES "dish_variants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
