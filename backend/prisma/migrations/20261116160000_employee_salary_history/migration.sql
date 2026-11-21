ALTER TABLE "salary_accruals" ADD COLUMN "supplemental" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "employee_salary_rates" (
  "cafe_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "effective_month" TEXT NOT NULL,
  "position_id" TEXT,
  "position_name" TEXT NOT NULL,
  "hourly" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "per_shift" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "monthly" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "personal_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "shift_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  CONSTRAINT "employee_salary_rates_pkey" PRIMARY KEY ("cafe_id", "user_id", "effective_month"),
  CONSTRAINT "employee_salary_rates_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Preserve the available rate history of each current assignment. Previous assignments
-- were not recorded and cannot be reconstructed by this migration.
INSERT INTO "employee_salary_rates" (
  "cafe_id", "user_id", "effective_month", "position_id", "position_name",
  "hourly", "per_shift", "monthly", "personal_percent", "shift_percent"
)
SELECT u."cafe_id", u."id", r."effective_month", p."id", p."name",
  r."hourly", r."per_shift", r."monthly", r."personal_percent", r."shift_percent"
FROM "users" u
JOIN "staff_positions" p ON p."cafe_id" = u."cafe_id" AND p."id" = u."position_id"
JOIN "staff_position_salary_rates" r ON r."cafe_id" = p."cafe_id" AND r."position_id" = p."id";

-- Also freeze the current zero-rate assignment, so a later position change cannot
-- introduce a salary into an earlier month that had no configured rate.
INSERT INTO "employee_salary_rates" ("cafe_id", "user_id", "effective_month", "position_id", "position_name")
SELECT u."cafe_id", u."id", to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek', 'YYYY-MM'), p."id", COALESCE(p."name", '')
FROM "users" u
LEFT JOIN "staff_positions" p ON p."cafe_id" = u."cafe_id" AND p."id" = u."position_id"
WHERE u."cafe_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "employee_salary_rates" r WHERE r."cafe_id" = u."cafe_id" AND r."user_id" = u."id");
