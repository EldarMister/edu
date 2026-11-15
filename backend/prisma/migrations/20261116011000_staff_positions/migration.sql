CREATE TABLE "staff_positions" (
  "id" TEXT NOT NULL,
  "cafe_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "permissions" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_positions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_positions_assignable_role" CHECK ("role" IN ('ADMIN', 'WAITER', 'KITCHEN', 'BAR')),
  CONSTRAINT "staff_positions_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "staff_positions_cafe_id_id_key" ON "staff_positions"("cafe_id", "id");
CREATE UNIQUE INDEX "staff_positions_cafe_id_name_key" ON "staff_positions"("cafe_id", "name");

ALTER TABLE "users" ADD COLUMN "position_id" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_cafe_id_position_id_fkey"
  FOREIGN KEY ("cafe_id", "position_id") REFERENCES "staff_positions"("cafe_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_assignable_position" CHECK (
  "position_id" IS NULL OR ("cafe_id" IS NOT NULL AND "role" IN ('ADMIN', 'WAITER', 'KITCHEN', 'BAR'))
);
CREATE INDEX "users_cafe_id_position_id_idx" ON "users"("cafe_id", "position_id");
