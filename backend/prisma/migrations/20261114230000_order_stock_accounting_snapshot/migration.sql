-- Existing lines have already crossed the old accounting boundary. Preserve
-- that fact without inventing a historical recipe or a cost for absent evidence.
ALTER TABLE order_items ADD COLUMN stock_accounting_snapshot JSONB;
UPDATE order_items SET stock_accounting_snapshot=jsonb_build_object('version',1,'legacyRecorded',true)
WHERE stock_accounting_snapshot IS NULL;
