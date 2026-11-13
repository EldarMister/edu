ALTER TABLE "categories" ALTER COLUMN "prep_station" DROP DEFAULT;
ALTER TABLE "order_items" ALTER COLUMN "prep_station" DROP DEFAULT;
ALTER TABLE "categories" ALTER COLUMN "prep_station" TYPE TEXT USING "prep_station"::TEXT;
ALTER TABLE "dishes" ALTER COLUMN "prep_station" TYPE TEXT USING "prep_station"::TEXT;
ALTER TABLE "order_items" ALTER COLUMN "prep_station" TYPE TEXT USING "prep_station"::TEXT;
ALTER TABLE "categories" ALTER COLUMN "prep_station" SET DEFAULT 'kitchen';
ALTER TABLE "order_items" ALTER COLUMN "prep_station" SET DEFAULT 'kitchen';
DROP TYPE "PrepStation";

CREATE TABLE "preparation_stations" (
  "id" TEXT NOT NULL,
  "cafe_id" TEXT NOT NULL REFERENCES "cafes"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "preparation_stations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "preparation_stations_cafe_id_name_key" ON "preparation_stations"("cafe_id", "name");
CREATE INDEX "order_items_cafe_id_prep_station_status_updated_at_idx" ON "order_items"("cafe_id", "prep_station", "status", "updated_at");

ALTER TABLE "kitchen_events" ADD COLUMN "prep_station" TEXT;
