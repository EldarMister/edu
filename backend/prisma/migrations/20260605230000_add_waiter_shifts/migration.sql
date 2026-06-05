-- CreateEnum
CREATE TYPE "WaiterShiftStatus" AS ENUM ('active', 'closed');

-- CreateTable
CREATE TABLE "waiter_shifts" (
    "id" TEXT NOT NULL,
    "waiter_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "status" "WaiterShiftStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiter_shifts_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "waiter_shift_id" TEXT;

-- CreateIndex
CREATE INDEX "waiter_shifts_waiter_id_status_idx" ON "waiter_shifts"("waiter_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "waiter_shifts_one_active_per_waiter_idx" ON "waiter_shifts"("waiter_id") WHERE "status" = 'active';

-- CreateIndex
CREATE INDEX "orders_waiter_shift_id_idx" ON "orders"("waiter_shift_id");

-- AddForeignKey
ALTER TABLE "waiter_shifts" ADD CONSTRAINT "waiter_shifts_waiter_id_fkey" FOREIGN KEY ("waiter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_waiter_shift_id_fkey" FOREIGN KEY ("waiter_shift_id") REFERENCES "waiter_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
