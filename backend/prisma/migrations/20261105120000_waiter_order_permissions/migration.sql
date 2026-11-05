ALTER TYPE "KitchenEventType" ADD VALUE IF NOT EXISTS 'cancel';
ALTER TYPE "KitchenEventType" ADD VALUE IF NOT EXISTS 'change';
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "waiter_order_permissions" JSONB;
