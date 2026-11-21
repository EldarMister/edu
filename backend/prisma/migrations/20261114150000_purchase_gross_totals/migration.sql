ALTER TABLE purchase_items ADD COLUMN gross_total DECIMAL(12,2) NOT NULL DEFAULT 0;
UPDATE purchase_items SET gross_total = total;
