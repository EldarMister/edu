-- Опциональная интеграция сайта/приложения доставки для каждого кафе.
ALTER TABLE "settings"
  ADD COLUMN "delivery_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "delivery_api_key_hash" TEXT,
  ADD COLUMN "delivery_api_key_prefix" TEXT,
  ADD COLUMN "delivery_table_id" TEXT;

ALTER TABLE "orders"
  ADD COLUMN "external_order_id" TEXT,
  ADD COLUMN "delivery_customer_name" TEXT,
  ADD COLUMN "delivery_customer_phone" TEXT,
  ADD COLUMN "delivery_address" TEXT;

CREATE UNIQUE INDEX "settings_delivery_api_key_hash_key"
  ON "settings"("delivery_api_key_hash");

CREATE UNIQUE INDEX "orders_cafe_id_external_order_id_key"
  ON "orders"("cafe_id", "external_order_id");

CREATE INDEX "orders_source_status_idx" ON "orders"("source", "status");
