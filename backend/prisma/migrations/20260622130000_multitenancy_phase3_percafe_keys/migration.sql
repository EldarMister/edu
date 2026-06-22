-- Мультитенантность, Фаза 3: уникальные ключи и настройки — на уровне кафе.

-- 1) Нумерация заказов уникальна в пределах (кафе, бизнес-день), а не глобально.
DROP INDEX "orders_business_date_order_number_key";
CREATE UNIQUE INDEX "orders_cafe_id_business_date_order_number_key"
  ON "orders"("cafe_id", "business_date", "order_number");

-- 2) Настройки — одна строка на кафе (вместо singleton id="default").
--    Снимаем DB-DEFAULT 'default' с id (теперь id генерит Prisma как uuid),
--    меняем обычный индекс cafe_id на уникальный.
ALTER TABLE "settings" ALTER COLUMN "id" DROP DEFAULT;
DROP INDEX "settings_cafe_id_idx";
CREATE UNIQUE INDEX "settings_cafe_id_key" ON "settings"("cafe_id");
