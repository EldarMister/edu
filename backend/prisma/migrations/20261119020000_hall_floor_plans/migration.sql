ALTER TABLE "halls"
  ADD COLUMN "floor_plan" JSONB,
  ADD COLUMN "floor_plan_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "settings"
  ADD COLUMN "use_floor_plan" BOOLEAN NOT NULL DEFAULT FALSE;
