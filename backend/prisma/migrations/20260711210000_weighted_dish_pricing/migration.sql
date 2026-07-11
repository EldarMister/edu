ALTER TABLE "dishes"
ADD COLUMN "weighted_measure" TEXT NOT NULL DEFAULT 'weight',
ADD COLUMN "weighted_price_base" INTEGER NOT NULL DEFAULT 100;

ALTER TABLE "dishes"
ADD CONSTRAINT "dishes_weighted_measure_check"
CHECK ("weighted_measure" IN ('weight', 'volume')),
ADD CONSTRAINT "dishes_weighted_price_base_check"
CHECK ("weighted_price_base" IN (1, 100, 1000));
