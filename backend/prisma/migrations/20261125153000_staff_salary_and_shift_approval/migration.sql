ALTER TABLE "settings" ADD COLUMN "work_shift_approval_required" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "employee_salary_overrides" (
  "cafe_id" TEXT NOT NULL REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" TEXT NOT NULL,
  "effective_day" TEXT NOT NULL,
  "use_position" BOOLEAN NOT NULL,
  "hourly" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "per_shift" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "monthly" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "personal_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "shift_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  PRIMARY KEY ("cafe_id", "user_id", "effective_day")
);

CREATE TABLE "work_shift_requests" (
  "user_id" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "cafe_id" TEXT NOT NULL REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "request_id" TEXT NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rejected_at" TIMESTAMP(3)
);
CREATE INDEX "work_shift_requests_cafe_id_idx" ON "work_shift_requests"("cafe_id");
