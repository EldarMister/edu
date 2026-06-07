CREATE TABLE "dish_variants" (
    "id" TEXT NOT NULL,
    "dish_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dish_variants_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "order_items" ADD COLUMN "dish_variant_id" TEXT;
ALTER TABLE "order_items" ADD COLUMN "dish_variant_name_snapshot" TEXT;

CREATE INDEX "dish_variants_dish_id_idx" ON "dish_variants"("dish_id");
CREATE INDEX "order_items_dish_variant_id_idx" ON "order_items"("dish_variant_id");

ALTER TABLE "dish_variants"
ADD CONSTRAINT "dish_variants_dish_id_fkey"
FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items"
ADD CONSTRAINT "order_items_dish_variant_id_fkey"
FOREIGN KEY ("dish_variant_id") REFERENCES "dish_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
