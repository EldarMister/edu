ALTER TABLE "dishes"
ADD COLUMN "is_weighted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "order_items"
ADD COLUMN "weight_grams" INTEGER;
