-- QR-меню стола: заказы без официанта (source=qr), токен стола и сущности QR-сессии.

-- Order: официант теперь необязателен (QR-заказ создаётся без сотрудника) + источник заказа.
ALTER TABLE "orders" ALTER COLUMN "waiter_id" DROP NOT NULL;
ALTER TABLE "orders" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'pos';

-- Table: неугадываемый токен для ссылки QR-меню. Бэкфилл случайным uuid для существующих столов.
ALTER TABLE "tables" ADD COLUMN "qr_token" TEXT;
UPDATE "tables" SET "qr_token" = gen_random_uuid()::text WHERE "qr_token" IS NULL;
ALTER TABLE "tables" ALTER COLUMN "qr_token" SET NOT NULL;
CREATE UNIQUE INDEX "tables_qr_token_key" ON "tables"("qr_token");

-- Сессия общего заказа стола.
CREATE TABLE "qr_table_sessions" (
    "id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submitted_order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "qr_table_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qr_table_sessions_submitted_order_id_key" ON "qr_table_sessions"("submitted_order_id");
CREATE INDEX "qr_table_sessions_table_id_status_idx" ON "qr_table_sessions"("table_id", "status");

-- Гость сессии (без авторизации, идентификация по guest_key из localStorage).
CREATE TABLE "qr_guests" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "guest_key" TEXT NOT NULL,
    "guest_label" TEXT NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "qr_guests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qr_guests_session_id_guest_key_key" ON "qr_guests"("session_id", "guest_key");
CREATE INDEX "qr_guests_session_id_idx" ON "qr_guests"("session_id");

-- Позиция общего заказа, привязанная к гостю.
CREATE TABLE "qr_session_items" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "dish_id" TEXT,
    "variant_id" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "snapshot_name" TEXT NOT NULL,
    "variant_name" TEXT,
    "snapshot_price" DECIMAL(10,2) NOT NULL,
    "selected_addons" JSONB,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "qr_session_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "qr_session_items_session_id_idx" ON "qr_session_items"("session_id");
CREATE INDEX "qr_session_items_guest_id_idx" ON "qr_session_items"("guest_id");

-- Внешние ключи.
ALTER TABLE "qr_table_sessions" ADD CONSTRAINT "qr_table_sessions_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "qr_table_sessions" ADD CONSTRAINT "qr_table_sessions_submitted_order_id_fkey" FOREIGN KEY ("submitted_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "qr_guests" ADD CONSTRAINT "qr_guests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "qr_table_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "qr_session_items" ADD CONSTRAINT "qr_session_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "qr_table_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "qr_session_items" ADD CONSTRAINT "qr_session_items_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "qr_guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "qr_session_items" ADD CONSTRAINT "qr_session_items_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
