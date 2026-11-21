ALTER TABLE "settings"
  ADD COLUMN "receipt_language" TEXT NOT NULL DEFAULT 'ru' CHECK ("receipt_language" IN ('ru', 'ky')),
  ADD COLUMN "receipt_print_cafe_name" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "receipt_print_address" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "receipt_print_phone" BOOLEAN NOT NULL DEFAULT true;
