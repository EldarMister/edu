-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'processing';

-- AlterEnum
ALTER TYPE "StockMovementSource" ADD VALUE 'processing';

-- AlterTable
ALTER TABLE "dishes" ADD COLUMN     "allow_ingredient_exclusions" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "excluded_ingredient_ids" JSONB,
ADD COLUMN     "excluded_ingredient_names" JSONB,
ADD COLUMN     "modifier_selections" JSONB;

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "processing_losses" JSONB;

-- AlterTable
ALTER TABLE "recipe_items" ADD COLUMN     "processing_method" TEXT;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "address" TEXT;

-- AlterTable
ALTER TABLE "preparation_recipes" ADD COLUMN     "instructions" TEXT;

-- AlterTable
ALTER TABLE "preparation_recipe_items" ADD COLUMN     "loss_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "net_amount" DECIMAL(14,3),
ADD COLUMN     "processing_method" TEXT;

-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN     "package_factor" DECIMAL(14,6),
ADD COLUMN     "package_id" TEXT,
ADD COLUMN     "package_name" TEXT,
ADD COLUMN     "package_quantity" DECIMAL(14,6),
ADD COLUMN     "package_unit" TEXT;

-- AlterTable
ALTER TABLE "warehouse_suppliers" ADD COLUMN     "address" TEXT,
ADD COLUMN     "tax_id" TEXT;

-- CreateTable
CREATE TABLE "warehouse_packages" (
    "id" TEXT NOT NULL,
    "cafe_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_type" "IngredientUnitType" NOT NULL,
    "quantity" DECIMAL(14,6) NOT NULL,
    "quantity_base" DECIMAL(14,3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_documents" (
    "id" TEXT NOT NULL,
    "cafe_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "request_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "has_unknown_cost" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3),
    "posted_by_id" TEXT,
    "posted_by_name" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by_id" TEXT,
    "reversed_by_name" TEXT,
    "reverse_reason" TEXT,

    CONSTRAINT "processing_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_lines" (
    "id" TEXT NOT NULL,
    "cafe_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "warehouse_name" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_cost" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "line_cost" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "cost_share_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "processing_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_modifier_groups" (
    "id" TEXT NOT NULL,
    "cafe_id" TEXT,
    "dish_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "min_selections" INTEGER NOT NULL DEFAULT 0,
    "max_selections" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menu_modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_modifier_options" (
    "id" TEXT NOT NULL,
    "cafe_id" TEXT,
    "group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ingredient_id" TEXT,
    "amount" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "amount_unit" TEXT NOT NULL DEFAULT 'pcs',
    "from_common_warehouse" BOOLEAN NOT NULL DEFAULT false,
    "warehouse_id" TEXT,
    "max_quantity" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menu_modifier_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouse_packages_cafe_id_unit_type_is_active_idx" ON "warehouse_packages"("cafe_id", "unit_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_packages_cafe_id_name_unit_type_quantity_base_key" ON "warehouse_packages"("cafe_id", "name", "unit_type", "quantity_base");

-- CreateIndex
CREATE INDEX "processing_documents_cafe_id_date_idx" ON "processing_documents"("cafe_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "processing_documents_cafe_id_id_key" ON "processing_documents"("cafe_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "processing_documents_cafe_id_request_key_key" ON "processing_documents"("cafe_id", "request_key");

-- CreateIndex
CREATE INDEX "processing_lines_cafe_id_ingredient_id_idx" ON "processing_lines"("cafe_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "processing_lines_document_id_direction_ingredient_id_wareho_key" ON "processing_lines"("document_id", "direction", "ingredient_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "menu_modifier_groups_cafe_id_dish_id_idx" ON "menu_modifier_groups"("cafe_id", "dish_id");

-- CreateIndex
CREATE INDEX "menu_modifier_options_cafe_id_group_id_idx" ON "menu_modifier_options"("cafe_id", "group_id");

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "warehouse_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_packages" ADD CONSTRAINT "warehouse_packages_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_documents" ADD CONSTRAINT "processing_documents_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_lines" ADD CONSTRAINT "processing_lines_cafe_id_document_id_fkey" FOREIGN KEY ("cafe_id", "document_id") REFERENCES "processing_documents"("cafe_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_lines" ADD CONSTRAINT "processing_lines_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_lines" ADD CONSTRAINT "processing_lines_cafe_id_warehouse_id_fkey" FOREIGN KEY ("cafe_id", "warehouse_id") REFERENCES "warehouses"("cafe_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_modifier_groups" ADD CONSTRAINT "menu_modifier_groups_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_modifier_options" ADD CONSTRAINT "menu_modifier_options_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "menu_modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_modifier_options" ADD CONSTRAINT "menu_modifier_options_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_modifier_options" ADD CONSTRAINT "menu_modifier_options_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Promote the existing item-specific packages into the common catalog without
-- losing their definitions. Quantities are normalized before deduplication.
WITH definitions AS (
 SELECT i.cafe_id, trim(u->>'name') AS name, i.unit_type,
   CASE i.unit_type WHEN 'mass' THEN 'g' WHEN 'volume' THEN 'ml' ELSE 'pcs' END AS unit,
   ROUND((u->>'factor')::numeric * CASE i.display_unit WHEN 'kg' THEN 1000 WHEN 'l' THEN 1000 ELSE 1 END,3) AS quantity
 FROM ingredients i CROSS JOIN LATERAL jsonb_array_elements(i.purchase_units) u
 WHERE i.cafe_id IS NOT NULL AND jsonb_typeof(u->'factor')='number' AND trim(u->>'name')<>''
), grouped AS (
 SELECT cafe_id, min(name) AS name, unit_type, unit, quantity,
 lower(translate(name,'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя')) AS normalized_name
 FROM definitions WHERE quantity>0 AND quantity<100000000
 GROUP BY cafe_id,unit_type,unit,quantity,lower(translate(name,'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя'))
)
INSERT INTO warehouse_packages (id,cafe_id,name,unit,unit_type,quantity,quantity_base,updated_at)
SELECT 'package:'||md5(cafe_id||':'||normalized_name||':'||unit_type::text||':'||quantity::text),cafe_id,name,unit,unit_type,quantity,quantity,NOW()
FROM grouped;
UPDATE purchase_items p SET package_name=p.unit,
 package_unit=CASE i.unit_type WHEN 'mass' THEN 'g' WHEN 'volume' THEN 'ml' ELSE 'pcs' END,
 package_quantity=ROUND(p.quantity_base/p.quantity,6),package_factor=ROUND(p.quantity_base/p.quantity,6)
FROM ingredients i WHERE p.ingredient_id=i.id AND p.quantity>0 AND p.unit NOT IN ('g','kg','ml','l','pcs','г','кг','мл','л','шт')
 AND p.quantity_base/p.quantity<100000000;
UPDATE purchase_items p SET package_id=k.id FROM warehouse_packages k,ingredients i
WHERE p.ingredient_id=i.id AND p.cafe_id=k.cafe_id AND i.unit_type=k.unit_type
 AND p.package_factor=k.quantity_base
 AND lower(translate(trim(p.package_name),'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя'))=lower(translate(k.name,'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя'));
ALTER TABLE processing_documents ADD CONSTRAINT processing_documents_status_check CHECK(status IN ('draft','posted','reversed'));
ALTER TABLE processing_lines ADD CONSTRAINT processing_lines_direction_check CHECK(direction IN ('input','output'));
ALTER TABLE processing_lines ADD CONSTRAINT processing_lines_quantity_check CHECK(quantity>0 AND unit_cost>=0 AND line_cost>=0 AND cost_share_percent>=0 AND cost_share_percent<=100);
