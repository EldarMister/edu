ALTER TABLE "orders"
  ADD COLUMN "requires_waiter_decision" BOOLEAN NOT NULL DEFAULT false;
