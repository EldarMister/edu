ALTER TABLE "warehouse_documents" ADD COLUMN "effective_at" TIMESTAMP(3);
ALTER TABLE "purchases" ADD COLUMN "effective_at" TIMESTAMP(3), ADD COLUMN "stock_posted_at" TIMESTAMP(3);
ALTER TABLE "stock_movements" ADD COLUMN "recorded_at" TIMESTAMP(3), ADD COLUMN "receipt_value" DECIMAL(12, 2);
