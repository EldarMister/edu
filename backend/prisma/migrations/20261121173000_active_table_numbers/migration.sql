BEGIN;

-- An archived table keeps its number, orders and QR code.
DROP INDEX "tables_hall_id_number_key";
CREATE INDEX "tables_hall_id_number_idx" ON "tables"("hall_id", "number");
CREATE UNIQUE INDEX "tables_active_hall_id_number_key" ON "tables"("hall_id", "number")
WHERE "is_active";

COMMIT;
