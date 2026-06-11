-- Дневная нумерация заказов: номер сбрасывается каждый день.
-- Бизнес-день заказа + снятие глобальной уникальности номера, уникальность теперь в пределах дня.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "business_date" TIMESTAMP(3);

-- Бэкилл существующих заказов: бизнес-день = дата создания.
UPDATE "orders" SET "business_date" = date_trunc('day', "created_at") WHERE "business_date" IS NULL;

ALTER TABLE "orders" ALTER COLUMN "business_date" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "business_date" SET DEFAULT CURRENT_TIMESTAMP;

-- Снимаем глобальную уникальность order_number (теперь номер уникален только в дне).
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_order_number_key";
DROP INDEX IF EXISTS "orders_order_number_key";

-- Уникальность номера в пределах бизнес-дня.
CREATE UNIQUE INDEX IF NOT EXISTS "orders_business_date_order_number_key"
  ON "orders"("business_date", "order_number");
