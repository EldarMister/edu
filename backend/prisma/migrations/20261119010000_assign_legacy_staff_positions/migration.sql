BEGIN;

-- Keep effective access and salary settings when assigning older staff accounts.
DO $$
DECLARE
  profile RECORD;
  assigned_position_id TEXT;
  base_name TEXT;
  position_name TEXT;
  suffix INTEGER;
BEGIN
  FOR profile IN
    SELECT DISTINCT u."cafe_id", u."role", CASE
      WHEN jsonb_typeof(u."permissions") = 'object' THEN u."permissions"
      ELSE '{}'::JSONB
    END AS permissions
    FROM "users" u
    WHERE u."cafe_id" IS NOT NULL AND u."role" <> 'OWNER'
      AND NOT EXISTS (
        SELECT 1 FROM "staff_positions" p
        WHERE p."cafe_id" = u."cafe_id" AND p."id" = u."position_id" AND p."role" = u."role"
      )
  LOOP
    SELECT p."id" INTO assigned_position_id
    FROM "staff_positions" p
    WHERE p."cafe_id" = profile."cafe_id" AND p."role" = profile."role"
      AND p."is_starter" AND p."permissions" = profile.permissions
      AND NOT EXISTS (
        SELECT 1 FROM "staff_position_salary_rates" r
        WHERE r."cafe_id" = p."cafe_id" AND r."position_id" = p."id"
      );

    IF assigned_position_id IS NULL THEN
      base_name := CASE profile."role"
        WHEN 'ADMIN' THEN 'Администратор'
        WHEN 'WAITER' THEN 'Официант'
        WHEN 'KITCHEN' THEN 'Кухня'
        WHEN 'BAR' THEN 'Бар'
      END || ' (прежние права)';
      position_name := base_name;
      suffix := 1;
      WHILE EXISTS (
        SELECT 1 FROM "staff_positions"
        WHERE "cafe_id" = profile."cafe_id" AND lower("name") = lower(position_name)
      ) LOOP
        suffix := suffix + 1;
        position_name := base_name || ' ' || suffix;
      END LOOP;

      INSERT INTO "staff_positions" ("id", "cafe_id", "name", "role", "permissions", "updated_at")
      VALUES (gen_random_uuid()::TEXT, profile."cafe_id", position_name, profile."role",
        profile.permissions, CURRENT_TIMESTAMP)
      RETURNING "id" INTO assigned_position_id;
    END IF;

    UPDATE "users" u SET "position_id" = assigned_position_id, "permissions" = NULL
    WHERE u."cafe_id" = profile."cafe_id" AND u."role" = profile."role"
      AND CASE WHEN jsonb_typeof(u."permissions") = 'object' THEN u."permissions" ELSE '{}'::JSONB END = profile.permissions
      AND NOT EXISTS (
        SELECT 1 FROM "staff_positions" p
        WHERE p."cafe_id" = u."cafe_id" AND p."id" = u."position_id" AND p."role" = u."role"
      );
  END LOOP;
END $$;

COMMIT;
