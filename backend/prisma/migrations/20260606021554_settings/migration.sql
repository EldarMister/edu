-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "cafe_name" TEXT NOT NULL DEFAULT 'EDU CAFE',
    "address" TEXT NOT NULL DEFAULT 'г. Бишкек, ул. Киевская 120',
    "phone" TEXT NOT NULL DEFAULT '+996 500 123 456',
    "phone2" TEXT NOT NULL DEFAULT '+996 700 123 456',
    "receipt_text" TEXT NOT NULL DEFAULT 'Спасибо за покупку!',
    "language" TEXT NOT NULL DEFAULT 'ru',
    "pay_qr" BOOLEAN NOT NULL DEFAULT true,
    "pay_cash" BOOLEAN NOT NULL DEFAULT true,
    "pay_card" BOOLEAN NOT NULL DEFAULT true,
    "printer_connected" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);
