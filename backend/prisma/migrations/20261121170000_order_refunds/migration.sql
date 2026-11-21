CREATE TYPE "OrderRefundStatus" AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE "orders" ADD COLUMN "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0
  CHECK ("refunded_amount" >= 0);
ALTER TABLE "payments" ADD COLUMN "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0
  CHECK ("refunded_amount" >= 0);
ALTER TABLE "order_items" ADD COLUMN "refunded_quantity" INTEGER NOT NULL DEFAULT 0
  CHECK ("refunded_quantity" >= 0);
ALTER TABLE "order_taxes" ADD COLUMN "item_amounts" JSONB;

CREATE TABLE "order_refunds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cafe_id" TEXT,
    "order_id" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "item_id" TEXT,
    "quantity" INTEGER,
    "reason" TEXT NOT NULL,
    "status" "OrderRefundStatus" NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(10,2) NOT NULL CHECK ("amount" >= 0),
    "items" JSONB NOT NULL,
    "payment_parts" JSONB NOT NULL,
    "tax_reversals" JSONB NOT NULL,
    "quote_version" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "requested_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMP(3),
    "fiscal_refund_reference" TEXT,
    "restocked_goods" BOOLEAN NOT NULL DEFAULT false,
    CHECK (("item_id" IS NULL AND "quantity" IS NULL) OR ("item_id" IS NOT NULL AND "quantity" IS NOT NULL AND "quantity" > 0))
);

CREATE INDEX "order_refunds_order_id_created_at_idx" ON "order_refunds"("order_id", "created_at");
CREATE INDEX "order_refunds_cafe_id_status_created_at_idx" ON "order_refunds"("cafe_id", "status", "created_at");
CREATE INDEX "order_refunds_cafe_id_status_decided_at_idx" ON "order_refunds"("cafe_id", "status", "decided_at");
CREATE UNIQUE INDEX "order_refunds_fiscal_reference_key" ON "order_refunds"("order_id", "fiscal_refund_reference");
CREATE UNIQUE INDEX "order_refunds_one_pending_per_order" ON "order_refunds"("order_id") WHERE "status" = 'pending';
