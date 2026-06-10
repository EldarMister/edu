-- Отдельное название блюда для озвучки кухни (ТЗ §6).
-- IF NOT EXISTS: колонка могла быть добавлена ранее вручную/через db push.
ALTER TABLE "dishes" ADD COLUMN IF NOT EXISTS "voice_name" TEXT;

-- Снимок названия для озвучки в позиции заказа (на момент заказа).
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "dish_voice_snapshot" TEXT;
