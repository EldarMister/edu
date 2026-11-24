ALTER TABLE "ingredients" ADD COLUMN "round_piece_writeoff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_round_piece_writeoff_check"
  CHECK (NOT "round_piece_writeoff" OR ("unit_type" = 'count' AND "kind" IN ('raw', 'consumable')));
