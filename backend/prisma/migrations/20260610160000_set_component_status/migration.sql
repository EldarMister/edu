-- AlterTable: каждое блюдо состава сета получает свой статус готовности/отказа,
-- чтобы кухня управляла позициями внутри сета по отдельности.
ALTER TABLE "order_item_set_components"
  ADD COLUMN "status" "OrderItemStatus" NOT NULL DEFAULT 'new',
  ADD COLUMN "reject_reason" TEXT;

-- Удалённые из сета блюда («без X») кухня не готовит — помечаем как отменённые.
UPDATE "order_item_set_components" SET "status" = 'cancelled' WHERE "action" = 'removed';
