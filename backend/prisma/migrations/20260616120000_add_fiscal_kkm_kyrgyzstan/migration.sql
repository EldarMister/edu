-- ККМ / фискализация (Кыргызстан): поля результата фискального чека на заказе
-- и настройки провайдера ККМ. Все поля nullable — поведение системы без ККМ не меняется.

-- Order: результат пробития фискального чека (один чек на оплаченный заказ).
ALTER TABLE "orders" ADD COLUMN "fiscal_receipt_number" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscal_sign" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscal_qr_code" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscal_error" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscalized_at" TIMESTAMP(3);

-- Settings: выбор провайдера ККМ и реквизиты подключения.
ALTER TABLE "settings" ADD COLUMN "fiscal_provider" TEXT;
ALTER TABLE "settings" ADD COLUMN "fiscal_ekassa_api_key" TEXT;
ALTER TABLE "settings" ADD COLUMN "fiscal_ekassa_url" TEXT;
ALTER TABLE "settings" ADD COLUMN "fiscal_ekassa_inn" TEXT;
ALTER TABLE "settings" ADD COLUMN "fiscal_yakassa_api_key" TEXT;
ALTER TABLE "settings" ADD COLUMN "fiscal_yakassa_url" TEXT;
