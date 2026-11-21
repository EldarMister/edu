ALTER TABLE "settings"
  ADD COLUMN "receipt_logo_data" TEXT,
  ADD COLUMN "round_order_total" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "telegram_stock_alerts_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "telegram_stock_chat_id" TEXT,
  ADD COLUMN "telegram_stock_alert_state" JSONB;

ALTER TABLE "orders"
  ADD COLUMN "round_order_total" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rounding_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;
