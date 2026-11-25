CREATE TABLE "ingredient_categories" (
  "cafe_id" TEXT NOT NULL REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  PRIMARY KEY ("cafe_id", "name")
);

INSERT INTO "ingredient_categories" ("cafe_id", "name")
SELECT DISTINCT "cafe_id", "category"
FROM "ingredients"
WHERE "cafe_id" IS NOT NULL AND "category" IS NOT NULL AND "category" <> ''
  AND NOT "is_prepared" AND "kind" IN ('raw', 'consumable');

ALTER TABLE "writeoff_reasons" ADD COLUMN "archived_at" TIMESTAMP(3);

DROP INDEX "writeoff_reasons_cafe_id_normalized_name_key";
CREATE UNIQUE INDEX "writeoff_reasons_cafe_id_active_name_key"
  ON "writeoff_reasons" ("cafe_id", "normalized_name") WHERE "archived_at" IS NULL;
