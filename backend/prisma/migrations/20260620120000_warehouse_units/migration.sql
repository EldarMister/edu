-- Складские единицы измерения: переход на хранение в БАЗОВЫХ единицах (g|ml|pcs)
-- с автоматической конвертацией. Бэкфилл переводит существующие данные из
-- старой текстовой единицы `ingredients.unit` в базу, сохраняя их смысл.
--
-- Коэффициенты: кг = 1000 г, л = 1000 мл, г/мл/шт = 1.
--   количество (display → база):  *factor
--   себестоимость (за display → за базу):  /factor

-- 1. Enum типа единицы.
DO $$ BEGIN
  CREATE TYPE "IngredientUnitType" AS ENUM ('mass', 'volume', 'count');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. Ingredient: расширяем точность ДО бэкфилла, чтобы не терять дробную себестоимость.
ALTER TABLE "ingredients" ALTER COLUMN "stock" TYPE DECIMAL(14,3);
ALTER TABLE "ingredients" ALTER COLUMN "low_stock_threshold" TYPE DECIMAL(14,3);
ALTER TABLE "ingredients" ALTER COLUMN "avg_cost" TYPE DECIMAL(20,8);

ALTER TABLE "ingredients" ADD COLUMN IF NOT EXISTS "unit_type" "IngredientUnitType" NOT NULL DEFAULT 'count';
ALTER TABLE "ingredients" ADD COLUMN IF NOT EXISTS "display_unit" TEXT NOT NULL DEFAULT 'pcs';

-- 3. RecipeItem: точность + новая колонка единицы.
ALTER TABLE "recipe_items" ALTER COLUMN "amount" TYPE DECIMAL(14,3);
ALTER TABLE "recipe_items" ADD COLUMN IF NOT EXISTS "amount_unit" TEXT NOT NULL DEFAULT 'pcs';

-- 4. PurchaseItem: точность цены + базовые колонки.
ALTER TABLE "purchase_items" ALTER COLUMN "quantity" TYPE DECIMAL(14,3);
ALTER TABLE "purchase_items" ALTER COLUMN "purchase_price" TYPE DECIMAL(20,8);
ALTER TABLE "purchase_items" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'pcs';
ALTER TABLE "purchase_items" ADD COLUMN IF NOT EXISTS "quantity_base" DECIMAL(14,3) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_items" ADD COLUMN IF NOT EXISTS "unit_price_base" DECIMAL(20,8) NOT NULL DEFAULT 0;

-- 5. StockMovement: количества в базе, себестоимость за базовую единицу.
ALTER TABLE "stock_movements" ALTER COLUMN "before_stock" TYPE DECIMAL(14,3);
ALTER TABLE "stock_movements" ALTER COLUMN "change" TYPE DECIMAL(14,3);
ALTER TABLE "stock_movements" ALTER COLUMN "after_stock" TYPE DECIMAL(14,3);
ALTER TABLE "stock_movements" ALTER COLUMN "cost_at_moment" TYPE DECIMAL(20,8);

-- ===================== БЭКФИЛЛ (по старому ingredients.unit) =====================

-- 6. Движения склада: количества *factor, себестоимость /factor.
UPDATE "stock_movements" sm SET
  "before_stock"   = sm."before_stock"   * f.factor,
  "change"         = sm."change"         * f.factor,
  "after_stock"    = sm."after_stock"    * f.factor,
  "cost_at_moment" = sm."cost_at_moment" / f.factor
FROM (
  SELECT i."id",
         CASE i."unit" WHEN 'кг' THEN 1000 WHEN 'л' THEN 1000 ELSE 1 END AS factor
  FROM "ingredients" i
) f
WHERE sm."ingredient_id" = f."id";

-- 7. Техкарта: amount *factor, amount_unit = display-код ингредиента.
UPDATE "recipe_items" ri SET
  "amount"      = ri."amount" * f.factor,
  "amount_unit" = f.code
FROM (
  SELECT i."id",
         CASE i."unit" WHEN 'кг' THEN 1000 WHEN 'л' THEN 1000 ELSE 1 END AS factor,
         CASE i."unit" WHEN 'кг' THEN 'kg' WHEN 'г' THEN 'g' WHEN 'л' THEN 'l' WHEN 'мл' THEN 'ml' WHEN 'шт' THEN 'pcs' ELSE 'pcs' END AS code
  FROM "ingredients" i
) f
WHERE ri."ingredient_id" = f."id";

-- 8. Позиции закупки: quantity/purchase_price остаются (display), пишем базовые.
UPDATE "purchase_items" pi SET
  "unit"            = f.code,
  "quantity_base"   = pi."quantity" * f.factor,
  "unit_price_base" = pi."purchase_price" / f.factor
FROM (
  SELECT i."id",
         CASE i."unit" WHEN 'кг' THEN 1000 WHEN 'л' THEN 1000 ELSE 1 END AS factor,
         CASE i."unit" WHEN 'кг' THEN 'kg' WHEN 'г' THEN 'g' WHEN 'л' THEN 'l' WHEN 'мл' THEN 'ml' WHEN 'шт' THEN 'pcs' ELSE 'pcs' END AS code
  FROM "ingredients" i
) f
WHERE pi."ingredient_id" = f."id";

-- 9. Сам ингредиент: тип/код единицы, остаток/порог *factor, себестоимость /factor.
UPDATE "ingredients" SET
  "unit_type" = (CASE "unit"
                   WHEN 'кг' THEN 'mass' WHEN 'г' THEN 'mass'
                   WHEN 'л' THEN 'volume' WHEN 'мл' THEN 'volume'
                   ELSE 'count' END)::"IngredientUnitType",
  "display_unit" = CASE "unit"
                     WHEN 'кг' THEN 'kg' WHEN 'г' THEN 'g'
                     WHEN 'л' THEN 'l' WHEN 'мл' THEN 'ml'
                     WHEN 'шт' THEN 'pcs' ELSE 'pcs' END,
  "stock"               = "stock"               * CASE "unit" WHEN 'кг' THEN 1000 WHEN 'л' THEN 1000 ELSE 1 END,
  "low_stock_threshold" = "low_stock_threshold" * CASE "unit" WHEN 'кг' THEN 1000 WHEN 'л' THEN 1000 ELSE 1 END,
  "avg_cost"            = "avg_cost"            / CASE "unit" WHEN 'кг' THEN 1000 WHEN 'л' THEN 1000 ELSE 1 END;

-- 10. Старая текстовая единица больше не нужна.
ALTER TABLE "ingredients" DROP COLUMN IF EXISTS "unit";

-- Снимаем временный DEFAULT с unit_type (в схеме default — count, оставим как есть).
