-- Платформенный супер-админ + подписка кафе.

-- Статус кафе.
CREATE TYPE "CafeStatus" AS ENUM ('active', 'suspended');

ALTER TABLE "cafes" ADD COLUMN "status" "CafeStatus" NOT NULL DEFAULT 'active';
ALTER TABLE "cafes" ADD COLUMN "paid_until" TIMESTAMP(3);
ALTER TABLE "cafes" ADD COLUMN "suspended_at" TIMESTAMP(3);
ALTER TABLE "cafes" ADD COLUMN "suspended_reason" TEXT;

-- Супер-админы платформы (вне мультитенантности).
CREATE TABLE "platform_admins" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_admins_login_key" ON "platform_admins"("login");
