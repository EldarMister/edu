ALTER TABLE "settings"
  ADD COLUMN "service_charge_amount" DECIMAL(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE "orders"
  ADD COLUMN "service_charge_amount" DECIMAL(10, 2) NOT NULL DEFAULT 0;
