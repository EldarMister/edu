-- Смешанная оплата: часть наличными, часть QR. Разбивка хранится в строках payments.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'mixed';
