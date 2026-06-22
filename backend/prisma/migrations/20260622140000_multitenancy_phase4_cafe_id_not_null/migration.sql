-- Мультитенантность, Фаза 4: cafe_id обязателен во всех тенант-таблицах.
-- Все строки уже забэкфиллены (Фаза 1), новые получают cafe_id из контекста (middleware)
-- или явно (seed/регистрация). Поле в Prisma-схеме оставлено nullable намеренно, чтобы
-- не требовать cafeId в каждом .create() — целостность гарантирует БД (NOT NULL).

-- Добивающий бэкфилл: строки, созданные между Фазой 1 и Фазой 2 без контекста
-- (cafe_id IS NULL), привязываем к «Кафе #1» (создано в Фазе 1, есть на любой такой БД).
UPDATE "users" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "halls" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "tables" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "categories" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "dishes" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "set_components" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "dish_variants" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "orders" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "order_actions" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "waiter_shifts" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "shift_cash_reports" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "order_items" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "order_item_set_components" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "payments" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "kitchen_events" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "staff_penalties_rewards" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "incidents" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "audit_logs" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "settings" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "push_subscriptions" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "receipt_print_requests" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "qr_table_sessions" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "qr_guests" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "qr_session_items" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "ingredients" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "recipe_items" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "purchases" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "purchase_items" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;
UPDATE "stock_movements" SET "cafe_id" = '00000000-0000-0000-0000-000000000001' WHERE "cafe_id" IS NULL;

ALTER TABLE "users" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "halls" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "tables" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "categories" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "dishes" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "set_components" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "dish_variants" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "order_actions" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "waiter_shifts" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "shift_cash_reports" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "order_items" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "order_item_set_components" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "payments" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "kitchen_events" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "staff_penalties_rewards" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "incidents" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "settings" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "push_subscriptions" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "receipt_print_requests" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "qr_table_sessions" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "qr_guests" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "qr_session_items" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "ingredients" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "recipe_items" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "purchases" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "purchase_items" ALTER COLUMN "cafe_id" SET NOT NULL;
ALTER TABLE "stock_movements" ALTER COLUMN "cafe_id" SET NOT NULL;
