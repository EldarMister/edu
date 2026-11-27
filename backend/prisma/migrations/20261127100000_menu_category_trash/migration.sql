ALTER TABLE "categories"
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "active_before_archive" BOOLEAN,
  ADD COLUMN "archive_root_id" TEXT;

ALTER TABLE "dishes" ADD COLUMN "archived_with_category_id" TEXT;

CREATE INDEX "categories_cafe_id_archive_root_id_idx" ON "categories" ("cafe_id", "archive_root_id");
CREATE INDEX "dishes_cafe_id_archived_with_category_id_idx" ON "dishes" ("cafe_id", "archived_with_category_id");
