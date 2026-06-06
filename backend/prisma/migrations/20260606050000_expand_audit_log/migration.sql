-- Расширение audit_logs: переименование action -> action_type и новые поля.

-- Новые столбцы (nullable, чтобы пройти на существующих строках).
ALTER TABLE "audit_logs"
  ADD COLUMN "action_type" TEXT,
  ADD COLUMN "user_name"   TEXT,
  ADD COLUMN "user_role"   TEXT,
  ADD COLUMN "table_id"    TEXT,
  ADD COLUMN "order_id"    TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "metadata"    JSONB;

-- Переносим старые значения action -> action_type.
UPDATE "audit_logs" SET "action_type" = "action" WHERE "action_type" IS NULL;

-- action_type обязателен.
ALTER TABLE "audit_logs" ALTER COLUMN "action_type" SET NOT NULL;

-- Удаляем старый столбец.
ALTER TABLE "audit_logs" DROP COLUMN "action";

-- Индексы.
CREATE INDEX "audit_logs_created_at_idx"  ON "audit_logs"("created_at");
CREATE INDEX "audit_logs_action_type_idx" ON "audit_logs"("action_type");
CREATE INDEX "audit_logs_user_id_idx"     ON "audit_logs"("user_id");
CREATE INDEX "audit_logs_order_id_idx"    ON "audit_logs"("order_id");
CREATE INDEX "audit_logs_table_id_idx"    ON "audit_logs"("table_id");
