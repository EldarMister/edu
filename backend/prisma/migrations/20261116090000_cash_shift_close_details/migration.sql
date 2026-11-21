ALTER TABLE "cash_shifts"
  ADD COLUMN "closing_comment" VARCHAR(500),
  ADD COLUMN "close_employee_shifts" BOOLEAN NOT NULL DEFAULT false;
