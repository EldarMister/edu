ALTER TABLE warehouse_documents DROP CONSTRAINT warehouse_documents_mode_check;
ALTER TABLE warehouse_documents ADD CONSTRAINT warehouse_documents_mode_check CHECK (
 (kind = 'inventory' AND mode IS NOT NULL AND reason IS NULL)
 OR (kind = 'writeoff' AND mode IS NULL)
 OR (kind IN ('transfer','supplier_return') AND mode IS NULL AND reason IS NULL)
);
