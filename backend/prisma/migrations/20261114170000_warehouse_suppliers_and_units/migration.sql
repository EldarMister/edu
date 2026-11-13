-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "purchase_units" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "supplier_id" TEXT;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "request_key" TEXT,
ADD COLUMN     "supplier_id" TEXT;

-- AlterTable
ALTER TABLE "preparation_batches" ADD COLUMN     "reverse_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "reversed_by_id" TEXT;

-- CreateTable
CREATE TABLE "warehouse_suppliers" (
    "id" TEXT NOT NULL,
    "cafe_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouse_suppliers_cafe_id_is_active_idx" ON "warehouse_suppliers"("cafe_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_suppliers_cafe_id_name_key" ON "warehouse_suppliers"("cafe_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_cafe_id_request_key_key" ON "purchases"("cafe_id", "request_key");

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "warehouse_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "warehouse_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_suppliers" ADD CONSTRAINT "warehouse_suppliers_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deduplicate historical names case-insensitively, preserving purchase snapshots.
INSERT INTO warehouse_suppliers (id,cafe_id,name,updated_at)
SELECT 'supplier:'||md5(cafe_id||':'||lower(trim(name))), cafe_id, min(trim(name)), NOW()
FROM (SELECT cafe_id,supplier AS name FROM purchases UNION ALL SELECT cafe_id,supplier AS name FROM ingredients) names
WHERE cafe_id IS NOT NULL AND name IS NOT NULL AND trim(name) <> ''
GROUP BY cafe_id,lower(trim(name));
UPDATE ingredients i SET supplier_id=s.id FROM warehouse_suppliers s
WHERE i.cafe_id=s.cafe_id AND lower(trim(i.supplier))=lower(trim(s.name));
UPDATE purchases p SET supplier_id=s.id FROM warehouse_suppliers s
WHERE p.cafe_id=s.cafe_id AND lower(trim(p.supplier))=lower(trim(s.name));
UPDATE ingredients SET purchase_units=jsonb_build_array(jsonb_build_object('name',purchase_unit,'factor',purchase_factor))
WHERE purchase_unit IS NOT NULL AND purchase_factor IS NOT NULL;
