CREATE TABLE "staff_position_salary_rates" (
    "cafe_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "effective_month" TEXT NOT NULL,
    "hourly" DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK ("hourly" >= 0),
    "per_shift" DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK ("per_shift" >= 0),
    "monthly" DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK ("monthly" >= 0),
    "personal_percent" DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK ("personal_percent" BETWEEN 0 AND 100),
    "shift_percent" DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK ("shift_percent" BETWEEN 0 AND 100),
    CONSTRAINT "staff_position_salary_rates_pkey" PRIMARY KEY ("cafe_id", "position_id", "effective_month"),
    CONSTRAINT "staff_position_salary_rates_position_fkey" FOREIGN KEY ("cafe_id", "position_id")
        REFERENCES "staff_positions"("cafe_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "salary_accruals" ADD COLUMN "calculation" JSONB;
