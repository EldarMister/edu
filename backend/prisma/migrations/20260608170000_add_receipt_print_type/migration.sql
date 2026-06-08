-- Тип печати: обычный чек или предварительный (предчек).
CREATE TYPE "ReceiptPrintType" AS ENUM ('receipt', 'preliminary');

ALTER TABLE "receipt_print_requests"
  ADD COLUMN "type" "ReceiptPrintType" NOT NULL DEFAULT 'receipt';
