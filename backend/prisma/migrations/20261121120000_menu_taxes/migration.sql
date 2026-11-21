CREATE TYPE "MenuTaxType" AS ENUM ('vat', 'turnover');

CREATE TABLE "menu_taxes" (
    "id" TEXT NOT NULL,
    "cafe_id" TEXT,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL CHECK ("rate" >= 0 AND "rate" <= 100),
    "type" "MenuTaxType" NOT NULL,
    CONSTRAINT "menu_taxes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "settings" ADD COLUMN "taxes_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "categories" ADD COLUMN "tax_id" TEXT;
ALTER TABLE "dishes" ADD COLUMN "tax_id" TEXT, ADD COLUMN "tax_exempt" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "menu_taxes_cafe_id_name_idx" ON "menu_taxes"("cafe_id", "name");
CREATE INDEX "categories_tax_id_idx" ON "categories"("tax_id");
CREATE INDEX "dishes_tax_id_idx" ON "dishes"("tax_id");
ALTER TABLE "categories" ADD CONSTRAINT "categories_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "menu_taxes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "menu_taxes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "order_taxes" (
    "id" TEXT NOT NULL,
    "cafe_id" TEXT,
    "order_id" TEXT NOT NULL,
    "tax_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "type" "MenuTaxType" NOT NULL,
    "sales_amount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sold_at" TIMESTAMP(3) NOT NULL,
    "reversed_at" TIMESTAMP(3),
    "fiscalized_at" TIMESTAMP(3),
    CONSTRAINT "order_taxes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_taxes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "order_taxes_order_id_sold_at_tax_id_key" ON "order_taxes"("order_id", "sold_at", "tax_id");
CREATE INDEX "order_taxes_cafe_id_sold_at_idx" ON "order_taxes"("cafe_id", "sold_at");
CREATE INDEX "order_taxes_cafe_id_reversed_at_idx" ON "order_taxes"("cafe_id", "reversed_at");
