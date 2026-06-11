-- «С собой» (навынос) на позиции заказа — кухня видит, что нужно упаковать.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "takeaway" BOOLEAN NOT NULL DEFAULT false;
