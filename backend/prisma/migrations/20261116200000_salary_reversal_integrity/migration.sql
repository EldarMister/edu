-- A salary can leave the account as a payout or return through an explicitly
-- identified reversal. Other transaction types cannot attach to an accrual.
ALTER TABLE "finance_entries" DROP CONSTRAINT "finance_entries_salary_check";
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_salary_check" CHECK (
  ("salary_accrual_id" IS NULL AND "kind" <> 'salary')
  OR ("salary_accrual_id" IS NOT NULL AND (
    "kind" = 'salary'
    OR ("kind" = 'adjustment' AND "amount" > 0 AND COALESCE("source_key" LIKE 'void:%', false))
  ))
);
