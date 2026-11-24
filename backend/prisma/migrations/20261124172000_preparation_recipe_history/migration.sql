CREATE TABLE "preparation_recipe_revisions" (
    "id" BIGSERIAL PRIMARY KEY,
    "cafe_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "replaced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" TEXT
);

CREATE INDEX "preparation_recipe_revisions_cafe_id_ingredient_id_replaced_idx"
    ON "preparation_recipe_revisions" ("cafe_id", "ingredient_id", "replaced_at");

-- No recipe history was captured before this migration. A null snapshot marks that boundary.
INSERT INTO "preparation_recipe_revisions" ("cafe_id", "ingredient_id")
SELECT "cafe_id", "id" FROM "ingredients" WHERE "is_prepared" AND "cafe_id" IS NOT NULL;
