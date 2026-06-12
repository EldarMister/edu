ALTER TABLE "settings"
  ADD COLUMN "shift_location_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cafe_latitude" DOUBLE PRECISION,
  ADD COLUMN "cafe_longitude" DOUBLE PRECISION,
  ADD COLUMN "shift_location_radius_meters" INTEGER NOT NULL DEFAULT 100;
