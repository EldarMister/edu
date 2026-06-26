-- Права доступа сотрудника (разделы/действия). null = дефолты по роли.
ALTER TABLE "users" ADD COLUMN "permissions" JSONB;
