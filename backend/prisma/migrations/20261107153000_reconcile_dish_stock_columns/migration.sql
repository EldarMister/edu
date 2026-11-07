-- Reconcile inventory columns already used by Prisma and existing installations.
ALTER TABLE "dishes"
  ADD COLUMN IF NOT EXISTS "stock" INTEGER,
  ADD COLUMN IF NOT EXISTS "initial_stock" INTEGER,
  ADD COLUMN IF NOT EXISTS "track_inventory" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'шт';

ALTER TABLE "dish_variants"
  ADD COLUMN IF NOT EXISTS "stock" INTEGER,
  ADD COLUMN IF NOT EXISTS "initial_stock" INTEGER,
  ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'шт';
