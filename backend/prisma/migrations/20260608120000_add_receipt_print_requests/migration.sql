-- Receipt print requests: waiter asks admin to print the receipt.
CREATE TYPE "ReceiptPrintStatus" AS ENUM ('pending', 'approved', 'rejected', 'printed');

CREATE TABLE "receipt_print_requests" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "waiter_id" TEXT NOT NULL,
  "table_number" INTEGER NOT NULL,
  "order_number" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "status" "ReceiptPrintStatus" NOT NULL DEFAULT 'pending',
  "decided_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMP(3),

  CONSTRAINT "receipt_print_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "receipt_print_requests_status_idx" ON "receipt_print_requests"("status");

CREATE INDEX "receipt_print_requests_waiter_id_idx" ON "receipt_print_requests"("waiter_id");

ALTER TABLE "receipt_print_requests"
  ADD CONSTRAINT "receipt_print_requests_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "receipt_print_requests"
  ADD CONSTRAINT "receipt_print_requests_waiter_id_fkey"
  FOREIGN KEY ("waiter_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
