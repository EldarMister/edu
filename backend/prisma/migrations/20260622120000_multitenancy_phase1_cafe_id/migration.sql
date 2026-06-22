-- Мультитенантность, Фаза 1: модель Cafe + cafe_id (nullable) во все тенант-таблицы.
-- Чисто аддитивно: ничего не удаляется и не переносится. Всё существующее
-- бэкфиллится в единственное «Кафе #1» (одна живая точка на момент миграции).

-- 1) Таблица заведений + первое кафе с фиксированным id для бэкфилла.
CREATE TABLE "cafes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cafes_pkey" PRIMARY KEY ("id")
);

INSERT INTO "cafes" ("id", "name", "is_active", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', 'Кафе #1', true, CURRENT_TIMESTAMP);

-- 2) cafe_id (nullable) во все тенант-таблицы.
ALTER TABLE "users" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "halls" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "tables" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "categories" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "dishes" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "set_components" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "dish_variants" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "orders" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "order_actions" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "waiter_shifts" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "shift_cash_reports" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "order_items" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "order_item_set_components" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "payments" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "kitchen_events" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "staff_penalties_rewards" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "incidents" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "settings" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "receipt_print_requests" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "qr_table_sessions" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "qr_guests" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "qr_session_items" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "ingredients" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "recipe_items" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "purchases" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "purchase_items" ADD COLUMN "cafe_id" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "cafe_id" TEXT;

-- 3) Бэкфилл: всё существующее принадлежит «Кафе #1».
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

-- 4) Индексы по cafe_id (под будущую авто-фильтрацию запросов по кафе).
CREATE INDEX "users_cafe_id_idx" ON "users"("cafe_id");
CREATE INDEX "halls_cafe_id_idx" ON "halls"("cafe_id");
CREATE INDEX "tables_cafe_id_idx" ON "tables"("cafe_id");
CREATE INDEX "categories_cafe_id_idx" ON "categories"("cafe_id");
CREATE INDEX "dishes_cafe_id_idx" ON "dishes"("cafe_id");
CREATE INDEX "set_components_cafe_id_idx" ON "set_components"("cafe_id");
CREATE INDEX "dish_variants_cafe_id_idx" ON "dish_variants"("cafe_id");
CREATE INDEX "orders_cafe_id_idx" ON "orders"("cafe_id");
CREATE INDEX "order_actions_cafe_id_idx" ON "order_actions"("cafe_id");
CREATE INDEX "waiter_shifts_cafe_id_idx" ON "waiter_shifts"("cafe_id");
CREATE INDEX "shift_cash_reports_cafe_id_idx" ON "shift_cash_reports"("cafe_id");
CREATE INDEX "order_items_cafe_id_idx" ON "order_items"("cafe_id");
CREATE INDEX "order_item_set_components_cafe_id_idx" ON "order_item_set_components"("cafe_id");
CREATE INDEX "payments_cafe_id_idx" ON "payments"("cafe_id");
CREATE INDEX "kitchen_events_cafe_id_idx" ON "kitchen_events"("cafe_id");
CREATE INDEX "staff_penalties_rewards_cafe_id_idx" ON "staff_penalties_rewards"("cafe_id");
CREATE INDEX "incidents_cafe_id_idx" ON "incidents"("cafe_id");
CREATE INDEX "audit_logs_cafe_id_idx" ON "audit_logs"("cafe_id");
CREATE INDEX "settings_cafe_id_idx" ON "settings"("cafe_id");
CREATE INDEX "push_subscriptions_cafe_id_idx" ON "push_subscriptions"("cafe_id");
CREATE INDEX "receipt_print_requests_cafe_id_idx" ON "receipt_print_requests"("cafe_id");
CREATE INDEX "qr_table_sessions_cafe_id_idx" ON "qr_table_sessions"("cafe_id");
CREATE INDEX "qr_guests_cafe_id_idx" ON "qr_guests"("cafe_id");
CREATE INDEX "qr_session_items_cafe_id_idx" ON "qr_session_items"("cafe_id");
CREATE INDEX "ingredients_cafe_id_idx" ON "ingredients"("cafe_id");
CREATE INDEX "recipe_items_cafe_id_idx" ON "recipe_items"("cafe_id");
CREATE INDEX "purchases_cafe_id_idx" ON "purchases"("cafe_id");
CREATE INDEX "purchase_items_cafe_id_idx" ON "purchase_items"("cafe_id");
CREATE INDEX "stock_movements_cafe_id_idx" ON "stock_movements"("cafe_id");

-- 5) Внешние ключи на cafes(id). RESTRICT: нельзя удалить кафе, пока есть его данные.
ALTER TABLE "users" ADD CONSTRAINT "users_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "halls" ADD CONSTRAINT "halls_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tables" ADD CONSTRAINT "tables_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "set_components" ADD CONSTRAINT "set_components_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dish_variants" ADD CONSTRAINT "dish_variants_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_actions" ADD CONSTRAINT "order_actions_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waiter_shifts" ADD CONSTRAINT "waiter_shifts_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_cash_reports" ADD CONSTRAINT "shift_cash_reports_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_item_set_components" ADD CONSTRAINT "order_item_set_components_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kitchen_events" ADD CONSTRAINT "kitchen_events_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_penalties_rewards" ADD CONSTRAINT "staff_penalties_rewards_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settings" ADD CONSTRAINT "settings_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipt_print_requests" ADD CONSTRAINT "receipt_print_requests_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qr_table_sessions" ADD CONSTRAINT "qr_table_sessions_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qr_guests" ADD CONSTRAINT "qr_guests_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qr_session_items" ADD CONSTRAINT "qr_session_items_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
