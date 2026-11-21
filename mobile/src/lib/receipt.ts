import { translate } from '@/lib/i18n';
import type { Receipt, ReceiptLanguage, ReceiptPrintSettings } from '@/types';

export const DEFAULT_RECEIPT_TEXT = 'Спасибо за покупку!';

export function receiptPrintSettings(settings: Partial<ReceiptPrintSettings>): ReceiptPrintSettings {
  return {
    receiptLanguage: settings.receiptLanguage === 'ky' ? 'ky' : 'ru',
    receiptPrintCafeName: settings.receiptPrintCafeName ?? true,
    receiptPrintAddress: settings.receiptPrintAddress ?? true,
    receiptPrintPhone: settings.receiptPrintPhone ?? true,
  };
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('996')) {
    return `+996 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9, 12)}`;
  }
  return phone;
}

export function formatReceiptPhones(phone?: string | null, phone2?: string | null): string {
  return [phone, phone2].flatMap((number) => {
    const trimmed = number?.trim();
    return trimmed ? [formatPhone(trimmed)] : [];
  }).join(' · ');
}

export function receiptHeader(receipt: Receipt, fiscal = false) {
  const settings = receiptPrintSettings(receipt);
  return {
    cafeName: fiscal || settings.receiptPrintCafeName ? receipt.cafeName.trim() : '',
    address: fiscal || settings.receiptPrintAddress ? receipt.address?.trim() ?? '' : '',
    phones: fiscal || settings.receiptPrintPhone ? formatReceiptPhones(receipt.phone, receipt.phone2) : '',
  };
}

export function receiptFooterText(text: string, language: ReceiptLanguage): string {
  return text === DEFAULT_RECEIPT_TEXT ? translate(text, language) : text;
}
