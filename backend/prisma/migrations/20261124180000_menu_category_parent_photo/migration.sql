ALTER TABLE "categories"
    ADD COLUMN "parent_id" TEXT,
    ADD COLUMN "inherit_tax" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "image_url" TEXT,
    ADD COLUMN "image_key" TEXT;

CREATE UNIQUE INDEX "categories_cafe_id_id_key" ON "categories" ("cafe_id", "id");
CREATE INDEX "categories_cafe_id_parent_id_idx" ON "categories" ("cafe_id", "parent_id");
ALTER TABLE "categories" ADD CONSTRAINT "categories_cafe_id_parent_id_fkey"
    FOREIGN KEY ("cafe_id", "parent_id") REFERENCES "categories" ("cafe_id", "id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
