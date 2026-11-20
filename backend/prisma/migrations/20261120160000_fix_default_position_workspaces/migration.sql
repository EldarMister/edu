BEGIN;

CREATE FUNCTION set_default_position_workspaces(target_cafe_id TEXT) RETURNS VOID
LANGUAGE sql AS $$
  UPDATE "staff_positions" AS position
  SET "permissions" = (
    CASE WHEN jsonb_typeof(position."permissions") = 'object'
      THEN position."permissions" ELSE '{}'::JSONB END
  ) || jsonb_build_object(
    'fixedWorkspace', CASE WHEN position."role" = 'WAITER' THEN 'terminal' ELSE 'production' END,
    'adminAccess', FALSE,
    'terminalAccess', position."role" = 'WAITER'
  ), "updated_at" = CURRENT_TIMESTAMP
  WHERE (target_cafe_id IS NULL OR position."cafe_id" = target_cafe_id)
    AND (
      (position."role" = 'WAITER' AND (position."is_starter" OR lower(btrim(position."name")) IN (lower('Официант'), lower('Касса'))))
      OR (position."role" = 'KITCHEN' AND (position."is_starter" OR lower(btrim(position."name")) = lower('Кухня')))
      OR (position."role" = 'BAR' AND (position."is_starter" OR lower(btrim(position."name")) = lower('Бар')))
    );
$$;

SELECT set_default_position_workspaces(NULL);

CREATE OR REPLACE FUNCTION seed_cafe_staff_positions() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM create_starter_staff_positions(NEW.id);
  PERFORM create_cashier_and_storekeeper_positions(NEW.id);
  PERFORM set_default_position_workspaces(NEW.id);
  RETURN NEW;
END;
$$;

COMMIT;
