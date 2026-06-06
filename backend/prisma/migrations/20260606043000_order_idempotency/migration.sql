-- Idempotent order mutations, for example adding items to an existing order.
CREATE TABLE "order_actions" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "order_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_actions_type_idempotency_key_key"
  ON "order_actions"("type", "idempotency_key");

CREATE INDEX "order_actions_order_id_type_idx"
  ON "order_actions"("order_id", "type");

ALTER TABLE "order_actions"
  ADD CONSTRAINT "order_actions_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Only one live order may occupy a table at the same time.
CREATE UNIQUE INDEX "orders_one_active_per_table_idx"
  ON "orders"("table_id")
  WHERE "status" IN (
    'sent_to_kitchen',
    'accepted_by_kitchen',
    'cooking',
    'ready',
    'picked_up',
    'served',
    'waiting_payment',
    'partially_rejected'
  );
