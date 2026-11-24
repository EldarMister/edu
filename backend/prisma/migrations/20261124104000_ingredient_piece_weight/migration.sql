ALTER TABLE "ingredients" ADD COLUMN "piece_weight_grams" DECIMAL(14,3);

ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_piece_weight_grams_check"
CHECK ("piece_weight_grams" IS NULL OR ("unit_type" = 'count' AND "piece_weight_grams" > 0));
