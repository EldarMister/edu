-- QR-меню: опциональная гео-проверка присутствия гостя у кафе.
ALTER TABLE "settings" ADD COLUMN "qr_geo_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "settings" ADD COLUMN "qr_geo_lat" DOUBLE PRECISION;
ALTER TABLE "settings" ADD COLUMN "qr_geo_lng" DOUBLE PRECISION;
ALTER TABLE "settings" ADD COLUMN "qr_geo_radius" INTEGER NOT NULL DEFAULT 150;
