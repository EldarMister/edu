-- CreateEnum
CREATE TYPE "SetComponentAction" AS ENUM ('default', 'removed', 'replaced');

-- AlterTable
ALTER TABLE "dishes" ADD COLUMN "is_set" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "set_components" (
    "id" TEXT NOT NULL,
    "set_id" TEXT NOT NULL,
    "dish_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "removable" BOOLEAN NOT NULL DEFAULT true,
    "replaceable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "set_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_set_components" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "original_dish_id" TEXT NOT NULL,
    "original_name_snapshot" TEXT NOT NULL,
    "final_dish_id" TEXT,
    "final_name_snapshot" TEXT,
    "action" "SetComponentAction" NOT NULL DEFAULT 'default',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,
    "price_delta" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_set_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "set_components_set_id_idx" ON "set_components"("set_id");

-- CreateIndex
CREATE INDEX "set_components_dish_id_idx" ON "set_components"("dish_id");

-- CreateIndex
CREATE INDEX "order_item_set_components_order_item_id_idx" ON "order_item_set_components"("order_item_id");

-- AddForeignKey
ALTER TABLE "set_components" ADD CONSTRAINT "set_components_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "dishes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_components" ADD CONSTRAINT "set_components_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_set_components" ADD CONSTRAINT "order_item_set_components_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_set_components" ADD CONSTRAINT "order_item_set_components_original_dish_id_fkey" FOREIGN KEY ("original_dish_id") REFERENCES "dishes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_set_components" ADD CONSTRAINT "order_item_set_components_final_dish_id_fkey" FOREIGN KEY ("final_dish_id") REFERENCES "dishes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
