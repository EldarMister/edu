-- Existing explicit stock policy is preserved; new cafes prohibit negative stock.
ALTER TABLE settings ALTER COLUMN allow_negative_ingredient_stock SET DEFAULT false;
CREATE TABLE recipe_revisions (
 id TEXT PRIMARY KEY,
 cafe_id TEXT,
 dish_id TEXT NOT NULL,
 version INTEGER NOT NULL,
 snapshot JSONB NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT recipe_revisions_dish_id_fkey FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX recipe_revisions_dish_id_version_key ON recipe_revisions(dish_id,version);
CREATE INDEX recipe_revisions_cafe_id_dish_id_idx ON recipe_revisions(cafe_id,dish_id);
