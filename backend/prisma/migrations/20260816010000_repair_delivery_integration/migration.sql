-- Repair installations where the delivery migration is recorded as applied
-- but one or more columns or indexes are missing from the physical schema.
-- Every statement is idempotent so this is safe for healthy databases too.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "delivery_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "delivery_api_key_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_api_key_prefix" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_table_id" TEXT;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "external_order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_customer_name" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_customer_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_address" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "settings_delivery_api_key_hash_key"
  ON "settings"("delivery_api_key_hash");

CREATE UNIQUE INDEX IF NOT EXISTS "orders_cafe_id_external_order_id_key"
  ON "orders"("cafe_id", "external_order_id");

CREATE INDEX IF NOT EXISTS "orders_source_status_idx"
  ON "orders"("source", "status");
