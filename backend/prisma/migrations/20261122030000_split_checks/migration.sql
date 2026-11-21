BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "orders" ADD COLUMN "split_from_order_id" TEXT;
ALTER TABLE "order_actions" ADD COLUMN "details" JSONB;
ALTER TABLE "orders" ADD CONSTRAINT "orders_split_from_order_id_fkey"
  FOREIGN KEY ("split_from_order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "orders_split_from_order_id_idx" ON "orders"("split_from_order_id");

-- The table can be occupied by one check family. A paid parent is no longer
-- active, but its remaining children must still keep other orders out.
DROP INDEX "orders_one_active_per_table_idx";
ALTER TABLE "orders" ADD CONSTRAINT "orders_one_active_family_per_table" EXCLUDE USING gist (
  "table_id" WITH =,
  COALESCE("split_from_order_id", "id") WITH <>
) WHERE (
  "source" <> 'delivery'
  AND "status" IN ('sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready', 'picked_up',
                    'served', 'waiting_payment', 'partially_rejected')
);

COMMIT;
