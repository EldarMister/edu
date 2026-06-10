-- #1 Полное удаление блюда из меню без потери истории заказов:
-- ссылки на блюдо обнуляются, позиция остаётся по сохранённым снимкам (snapshot).

-- order_items.dish_id → nullable + ON DELETE SET NULL
ALTER TABLE "order_items" ALTER COLUMN "dish_id" DROP NOT NULL;
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_dish_id_fkey";
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_dish_id_fkey"
  FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- order_item_set_components.original_dish_id → nullable + ON DELETE SET NULL
ALTER TABLE "order_item_set_components" ALTER COLUMN "original_dish_id" DROP NOT NULL;
ALTER TABLE "order_item_set_components" DROP CONSTRAINT IF EXISTS "order_item_set_components_original_dish_id_fkey";
ALTER TABLE "order_item_set_components"
  ADD CONSTRAINT "order_item_set_components_original_dish_id_fkey"
  FOREIGN KEY ("original_dish_id") REFERENCES "dishes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- #3 Модификации (варианты) блюд внутри сета.

-- Снимок названия варианта блюда состава в заказе (например, «1 л»).
ALTER TABLE "order_item_set_components" ADD COLUMN "original_variant_name_snapshot" TEXT;

-- Вариант блюда в составе сета (меню).
ALTER TABLE "set_components" ADD COLUMN "dish_variant_id" TEXT;
CREATE INDEX "set_components_dish_variant_id_idx" ON "set_components"("dish_variant_id");
ALTER TABLE "set_components"
  ADD CONSTRAINT "set_components_dish_variant_id_fkey"
  FOREIGN KEY ("dish_variant_id") REFERENCES "dish_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
