BEGIN;

CREATE FUNCTION enable_default_cashier_order_register(target_cafe_id TEXT) RETURNS VOID
LANGUAGE sql AS $$
  UPDATE "staff_positions" AS position
  SET "permissions" = jsonb_set(position."permissions", '{actions}', (
    CASE WHEN jsonb_typeof(position."permissions" -> 'actions') = 'object'
      THEN position."permissions" -> 'actions' ELSE '{}'::JSONB END
  ) || jsonb_build_object('viewAllOrders', TRUE)), "updated_at" = CURRENT_TIMESTAMP
  WHERE (target_cafe_id IS NULL OR position."cafe_id" = target_cafe_id)
    AND position."role" = 'WAITER'
    AND lower(btrim(position."name")) = lower('Касса')
    AND position."permissions" ->> 'fixedWorkspace' = 'terminal'
    AND jsonb_typeof(position."permissions" #> '{actions,viewAllOrders}') IS DISTINCT FROM 'boolean';
$$;

SELECT enable_default_cashier_order_register(NULL);

CREATE OR REPLACE FUNCTION seed_cafe_staff_positions() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM create_starter_staff_positions(NEW.id);
  PERFORM create_cashier_and_storekeeper_positions(NEW.id);
  PERFORM set_default_position_workspaces(NEW.id);
  PERFORM enable_default_cashier_order_register(NEW.id);
  RETURN NEW;
END;
$$;

COMMIT;
