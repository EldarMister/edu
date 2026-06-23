-- Экран очереди заказов (табло в зале): включается по желанию владельца.
-- Режим отображения: table — номера столов, number — номера заказов.
ALTER TABLE "settings" ADD COLUMN "queue_display_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "settings" ADD COLUMN "queue_display_mode" TEXT NOT NULL DEFAULT 'table';
