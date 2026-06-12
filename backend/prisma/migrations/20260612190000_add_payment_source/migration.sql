CREATE TYPE "PaymentSource" AS ENUM ('normal', 'split');

ALTER TABLE "payments"
  ADD COLUMN "source" "PaymentSource" NOT NULL DEFAULT 'normal';
