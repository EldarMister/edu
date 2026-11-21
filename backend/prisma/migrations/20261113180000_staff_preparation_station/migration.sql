ALTER TABLE "users" ADD COLUMN "prep_station" TEXT;
CREATE INDEX "users_cafe_id_prep_station_idx" ON "users"("cafe_id", "prep_station");
