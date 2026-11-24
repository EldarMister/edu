ALTER TABLE "users" ADD COLUMN "last_login_at" TIMESTAMP(3);

ALTER TABLE "staff_position_salary_rates" RENAME COLUMN "effective_month" TO "effective_day";
ALTER TABLE "employee_salary_rates" RENAME COLUMN "effective_month" TO "effective_day";
UPDATE "staff_position_salary_rates" SET "effective_day" = "effective_day" || '-01';
UPDATE "employee_salary_rates" SET "effective_day" = "effective_day" || '-01';
ALTER TABLE "staff_position_salary_rates" ADD COLUMN "category_rates" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "employee_salary_rates" ADD COLUMN "category_rates" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "orders" ADD COLUMN "payroll_opened_by_id" TEXT;
ALTER TABLE "order_items" ADD COLUMN "payroll_category_id" TEXT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_payroll_opened_by_id_fkey"
    FOREIGN KEY ("payroll_opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "orders_payroll_opened_by_id_idx" ON "orders"("payroll_opened_by_id");
