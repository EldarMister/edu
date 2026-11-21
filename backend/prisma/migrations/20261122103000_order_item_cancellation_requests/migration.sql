CREATE TYPE "OrderItemCancellationStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "order_item_cancellation_requests" (
    "id" TEXT NOT NULL,
    "cafe_id" TEXT,
    "order_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "OrderItemCancellationStatus" NOT NULL DEFAULT 'pending',
    "requested_by_id" TEXT NOT NULL,
    "requested_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    CONSTRAINT "order_item_cancellation_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_item_cancellation_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "order_item_cancellation_requests_cafe_id_status_created_at_idx"
    ON "order_item_cancellation_requests"("cafe_id", "status", "created_at");
CREATE INDEX "order_item_cancellation_requests_order_id_idx"
    ON "order_item_cancellation_requests"("order_id");
CREATE UNIQUE INDEX "order_item_cancellation_one_pending"
    ON "order_item_cancellation_requests"("order_id", "item_id") WHERE "status" = 'pending';
