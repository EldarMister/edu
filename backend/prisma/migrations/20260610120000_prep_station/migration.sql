-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'BAR';

-- CreateEnum
CREATE TYPE "PrepStation" AS ENUM ('kitchen', 'bar');

-- AlterTable
ALTER TABLE "categories"
  ADD COLUMN "prep_station" "PrepStation" NOT NULL DEFAULT 'kitchen';

-- AlterTable
ALTER TABLE "dishes"
  ADD COLUMN "prep_station" "PrepStation";

-- AlterTable
ALTER TABLE "order_items"
  ADD COLUMN "prep_station" "PrepStation" NOT NULL DEFAULT 'kitchen';
