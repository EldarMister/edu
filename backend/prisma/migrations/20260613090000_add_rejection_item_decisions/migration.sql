CREATE TYPE "RejectionDecision" AS ENUM ('pending', 'removed', 'replaced');

ALTER TABLE "order_items"
  ADD COLUMN "rejection_decision" "RejectionDecision",
  ADD COLUMN "replacement_for_item_id" TEXT;
