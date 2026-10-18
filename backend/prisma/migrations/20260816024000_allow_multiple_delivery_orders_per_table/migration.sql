-- Delivery orders intentionally share one hidden service table. The original
-- partial unique index treated that table like a dining-room table, so only
-- one active delivery order could exist and every later order failed with
-- P2002 on table_id.
DROP INDEX IF EXISTS "orders_one_active_per_table_idx";

-- Preserve the one-active-order rule for real POS/QR tables while allowing
-- any number of active delivery orders on the shared service table.
CREATE UNIQUE INDEX "orders_one_active_per_table_idx"
  ON "orders"("table_id")
  WHERE "source" <> 'delivery'
    AND "status" IN (
      'sent_to_kitchen',
      'accepted_by_kitchen',
      'cooking',
      'ready',
      'picked_up',
      'served',
      'waiting_payment',
      'partially_rejected'
    );
