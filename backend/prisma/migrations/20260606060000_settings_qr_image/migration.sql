-- Хранение QR-кода оплаты заведения (data URL). Один на заведение.
ALTER TABLE "settings" ADD COLUMN "qr_image_url" TEXT;
