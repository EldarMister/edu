BEGIN;

-- These positions are separate from the starter used by legacy role-only employee creation.
CREATE FUNCTION create_cashier_and_storekeeper_positions(target_cafe_id TEXT) RETURNS VOID
LANGUAGE sql AS $$
  INSERT INTO "staff_positions" ("id", "cafe_id", "name", "role", "permissions", "updated_at")
  SELECT gen_random_uuid()::TEXT, target_cafe_id, defaults.name, defaults.role, defaults.permissions, CURRENT_TIMESTAMP
  FROM (VALUES
    ('Касса', 'WAITER'::"Role", '{
      "terminalAccess": true,
      "adminAccess": false,
      "actions": {"acceptOrderPayments": true, "printReceipts": true, "requestReceiptPrints": false, "createDeliveryOrders": true}
    }'::JSONB),
    ('Кладовщик', 'ADMIN'::"Role", '{
      "terminalAccess": false,
      "adminAccess": true,
      "sections": {"orders": false, "tables": false, "staff": false, "checks": false, "menu": true, "warehouse": true},
      "actions": {
        "editMenu": true, "refundChecks": false, "exportReports": false, "closeShift": false,
        "acceptOrderPayments": false, "requestReceiptPrints": false,
        "warehouseApprove": true, "warehouseSettings": true
      }
    }'::JSONB)
  ) AS defaults(name, role, permissions)
  WHERE NOT EXISTS (
    SELECT 1 FROM "staff_positions" AS existing
    WHERE existing."cafe_id" = target_cafe_id AND lower(existing."name") = lower(defaults.name)
  )
  ON CONFLICT ("cafe_id", "name") DO NOTHING;
$$;

SELECT create_cashier_and_storekeeper_positions("id") FROM "cafes";

CREATE OR REPLACE FUNCTION seed_cafe_staff_positions() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM create_starter_staff_positions(NEW.id);
  PERFORM create_cashier_and_storekeeper_positions(NEW.id);
  RETURN NEW;
END;
$$;

COMMIT;
