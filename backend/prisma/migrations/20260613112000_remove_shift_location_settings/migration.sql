ALTER TABLE "settings"
  DROP COLUMN IF EXISTS "shift_location_enabled",
  DROP COLUMN IF EXISTS "cafe_latitude",
  DROP COLUMN IF EXISTS "cafe_longitude",
  DROP COLUMN IF EXISTS "shift_location_radius_meters";
