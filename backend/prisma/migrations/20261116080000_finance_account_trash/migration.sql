ALTER TABLE finance_accounts ADD COLUMN archived_at TIMESTAMP(3);

CREATE INDEX finance_accounts_cafe_id_archived_at_idx ON finance_accounts (cafe_id, archived_at);

ALTER TABLE finance_accounts ADD CONSTRAINT finance_archived_account_has_no_assignment
  CHECK (archived_at IS NULL OR (NOT is_default AND NOT is_collection));
