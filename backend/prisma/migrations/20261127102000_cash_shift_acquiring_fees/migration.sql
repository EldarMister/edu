ALTER TABLE "settings"
    ADD COLUMN "card_processing_fee_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    ADD COLUMN "qr_processing_fee_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    ADD CONSTRAINT "settings_processing_fee_rate_range"
    CHECK ("card_processing_fee_rate" BETWEEN 0 AND 100 AND "qr_processing_fee_rate" BETWEEN 0 AND 100);

ALTER TABLE "cash_shifts"
    ADD COLUMN "card_processing_fee_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    ADD COLUMN "qr_processing_fee_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    ADD CONSTRAINT "cash_shifts_processing_fee_rate_range"
    CHECK ("card_processing_fee_rate" BETWEEN 0 AND 100 AND "qr_processing_fee_rate" BETWEEN 0 AND 100);

ALTER TABLE "finance_entries" ADD COLUMN "payment_method" "PaymentMethod";
