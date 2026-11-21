BEGIN;

ALTER TABLE "staff_positions" ADD COLUMN "is_starter" BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX "staff_positions_cafe_id_starter_role_key"
  ON "staff_positions" ("cafe_id", "role") WHERE "is_starter";

CREATE FUNCTION create_starter_staff_positions(target_cafe_id TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  starter RECORD;
  position_name TEXT;
  name_suffix INTEGER;
BEGIN
  FOR starter IN
    SELECT * FROM (VALUES
      ('ADMIN'::"Role", 'Администратор'),
      ('WAITER'::"Role", 'Официант'),
      ('KITCHEN'::"Role", 'Кухня'),
      ('BAR'::"Role", 'Бар')
    ) AS starters(role, name)
  LOOP
    position_name := starter.name;
    name_suffix := 1;
    WHILE EXISTS (
      SELECT 1 FROM "staff_positions"
      WHERE "cafe_id" = target_cafe_id AND lower("name") = lower(position_name)
    ) LOOP
      position_name := starter.name || CASE
        WHEN name_suffix = 1 THEN ' (базовая)'
        ELSE ' (базовая ' || name_suffix || ')'
      END;
      name_suffix := name_suffix + 1;
    END LOOP;

    INSERT INTO "staff_positions" ("id", "cafe_id", "name", "role", "is_starter", "permissions", "updated_at")
    VALUES (gen_random_uuid()::TEXT, target_cafe_id, position_name, starter.role, TRUE, '{}'::JSONB, CURRENT_TIMESTAMP)
    ON CONFLICT ("cafe_id", "role") WHERE "is_starter" DO NOTHING;
  END LOOP;
END;
$$;

SELECT create_starter_staff_positions("id") FROM "cafes";

-- Keep existing individual permissions and explicitly assigned positions intact.
UPDATE "users" AS employee
SET "position_id" = starter."id"
FROM "staff_positions" AS starter
WHERE starter."is_starter"
  AND starter."cafe_id" = employee."cafe_id"
  AND starter."role" = employee."role"
  AND employee."position_id" IS NULL
  AND (employee."permissions" IS NULL OR employee."permissions" = 'null'::JSONB);

CREATE FUNCTION seed_cafe_staff_positions() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM create_starter_staff_positions(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER seed_cafe_staff_positions
AFTER INSERT ON "cafes"
FOR EACH ROW EXECUTE FUNCTION seed_cafe_staff_positions();

COMMIT;
