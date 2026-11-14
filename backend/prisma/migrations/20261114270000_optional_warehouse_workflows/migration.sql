ALTER TABLE settings ADD COLUMN warehouse_production_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN warehouse_processing_enabled BOOLEAN NOT NULL DEFAULT false;
