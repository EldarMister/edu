-- Never infer complete historical valuation from a nonzero average alone.
-- Earlier stock can contain quantities whose acquisition cost was never known.
-- This migration preserves every numeric book value and marks that provenance
-- conservatively until a new fully known stock layer replaces the old one.
ALTER TABLE ingredients ADD COLUMN valuation_known BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE warehouse_stock ADD COLUMN valuation_known BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stock_movements ADD COLUMN cost_known BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN before_valuation_known BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN valuation_known BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE warehouse_document_items ADD COLUMN cost_known BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE processing_lines ADD COLUMN cost_known BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE preparation_batches ADD COLUMN cost_known BOOLEAN NOT NULL DEFAULT false;
