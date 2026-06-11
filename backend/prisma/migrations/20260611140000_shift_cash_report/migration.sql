-- Факт сдачи наличных сотрудником за смену (на дату). «Касса (сдал)» в отчёте по сменам.
CREATE TABLE IF NOT EXISTS "shift_cash_reports" (
    "id" TEXT NOT NULL,
    "waiter_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "cash_handed" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_cash_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "shift_cash_reports_waiter_id_date_key"
    ON "shift_cash_reports"("waiter_id", "date");

DO $$ BEGIN
    ALTER TABLE "shift_cash_reports"
        ADD CONSTRAINT "shift_cash_reports_waiter_id_fkey"
        FOREIGN KEY ("waiter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
