-- Короткий код для публичной ссылки табло очереди (/q/CODE), чтобы вводить на ТВ вручную.
ALTER TABLE "settings" ADD COLUMN "queue_display_code" TEXT;
CREATE UNIQUE INDEX "settings_queue_display_code_key" ON "settings"("queue_display_code");
