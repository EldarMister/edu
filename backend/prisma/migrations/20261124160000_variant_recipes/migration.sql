ALTER TABLE "dish_variants" ADD COLUMN "recipe_metadata" JSONB;
ALTER TABLE "recipe_items" ADD COLUMN "variant_id" TEXT;

DROP INDEX "recipe_items_dish_id_ingredient_id_key";
CREATE UNIQUE INDEX "recipe_items_base_dish_ingredient_key"
    ON "recipe_items"("dish_id", "ingredient_id") WHERE "variant_id" IS NULL;
CREATE UNIQUE INDEX "recipe_items_dish_id_variant_id_ingredient_id_key"
    ON "recipe_items"("dish_id", "variant_id", "ingredient_id");
CREATE UNIQUE INDEX "dish_variants_dish_id_id_key" ON "dish_variants"("dish_id", "id");

ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_dish_id_variant_id_fkey"
    FOREIGN KEY ("dish_id", "variant_id") REFERENCES "dish_variants"("dish_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
