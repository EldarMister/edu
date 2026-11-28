BEGIN;

ALTER TABLE "orders"
  ADD COLUMN "delivery_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pickup_time" TEXT,
  ADD CONSTRAINT "orders_delivery_fee_check" CHECK ("delivery_fee" >= 0 AND ("source" = 'delivery' OR "delivery_fee" = 0)),
  ADD CONSTRAINT "orders_pickup_time_check" CHECK ("pickup_time" IS NULL OR "source" = 'pickup');

ALTER TABLE "orders" DROP CONSTRAINT "orders_one_active_family_per_table";
ALTER TABLE "orders" ADD CONSTRAINT "orders_one_active_family_per_table" EXCLUDE USING gist (
  "table_id" WITH =,
  COALESCE("split_from_order_id", "id") WITH <>
) WHERE (
  "source" NOT IN ('delivery', 'pickup')
  AND "status" IN ('sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready', 'picked_up',
                    'served', 'waiting_payment', 'partially_rejected')
);

COMMIT;
