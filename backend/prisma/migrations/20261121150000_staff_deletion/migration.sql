BEGIN;

ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Preserve historical records for prior deletions that can still be confirmed in the audit log.
WITH legacy_deletions AS (
  SELECT "cafe_id", "entity_id", MAX("created_at") AS "deleted_at"
  FROM "audit_logs"
  WHERE "action_type" = 'STAFF_DELETED'
    AND "entity_type" = 'STAFF'
    AND "metadata" @> '{"softDeleted": true}'::jsonb
  GROUP BY "cafe_id", "entity_id"
)
UPDATE "users" AS employee
SET "deleted_at" = deletion."deleted_at",
    "phone" = 'deleted:' || employee."id",
    "login" = NULL,
    "pin_hash" = NULL,
    "position_id" = NULL
FROM legacy_deletions AS deletion
WHERE employee."id" = deletion."entity_id"
  AND employee."cafe_id" IS NOT DISTINCT FROM deletion."cafe_id"
  AND NOT employee."is_active"
  AND employee."updated_at" <= deletion."deleted_at";

DELETE FROM "push_subscriptions"
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "deleted_at" IS NOT NULL);

DELETE FROM "user_devices"
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "deleted_at" IS NOT NULL);

ALTER TABLE "users" ADD CONSTRAINT "users_deleted_inactive_check"
  CHECK ("deleted_at" IS NULL OR NOT "is_active");

COMMIT;
