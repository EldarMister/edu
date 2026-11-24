ALTER TABLE "dishes"
    ADD COLUMN "archived_at" TIMESTAMP(3),
    ADD COLUMN "active_before_archive" BOOLEAN;
