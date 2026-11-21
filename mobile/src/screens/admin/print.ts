import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import QRCode from 'qrcode';
import type { Receipt } from '@/types';
import type { FiscalResult } from '@/services/api/admin';
import { translate } from '@/lib/i18n';
import { receiptFooterText, receiptHeader, receiptPrintSettings } from '@/lib/receipt';
import { displayOrderNumber, money, orderItemDisplayName, paymentMethodLabel, timeHM } from '@/utils/format';
import { waitForNativePrintReturn } from './nativePrintLifecycle';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const imageData = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function fiscalQr(value: string | undefined): string {
  if (!value) return '';
  if (imageData.test(value)) return `<img width="140" height="140" src="${escape(value)}">`;
  const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const path: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (modules.get(row, column)) path.push(`M${column + 4},${row + 4}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 ${modules.size + 8} ${modules.size + 8}"><rect width="100%" height="100%" fill="white"/><path d="${path.join('')}" fill="black"/></svg>`;
}

export async function printNativeReceipt(r: Receipt, preliminary = false, result?: FiscalResult | null, signal?: AbortSignal) {
  const fiscal = !preliminary && result?.success ? result : undefined;
  const receiptLanguage = receiptPrintSettings(r).receiptLanguage;
  const t = (label: string) => escape(translate(label, receiptLanguage));
  const header = receiptHeader(r, !!fiscal && !fiscal.simulated);
  const date = new Date(r.date);
  const dateStr = escape(`${date.toLocaleDateString(receiptLanguage === 'ky' ? 'ky-KG' : 'ru-RU')} ${timeHM(r.date)}`);
  const orderNumber = displayOrderNumber(r.orderNumber);
  const receiptKind = t(preliminary ? 'Счёт' : fiscal?.simulated ? 'Тестовый чек' : fiscal ? 'Фискальный чек' : 'Товарный чек');
  const orderPlace = r.source === 'delivery' ? translate('Доставка', receiptLanguage) : `${translate('Стол', receiptLanguage)} ${r.tableNumber}`;
  const waiter = r.source === 'delivery' && r.waiter === 'Онлайн-заказ' ? translate(r.waiter, receiptLanguage) : r.waiter;
  const rows = r.items.map((item) => (
    `<tr><td class="item-name">${escape(orderItemDisplayName(item))}</td><td class="c">${item.quantity}</td>
      <td class="r">${money(item.priceSnapshot)}</td><td class="r">${money(item.finalPrice)}</td></tr>`
  )).join('');
  const fiscalBlock = fiscal ? `<div class="dash"></div><div class="pair"><span>${t(fiscal.simulated ? 'Тестовый чек №' : 'Фискальный чек №')}</span>
    <span>${escape(fiscal.fiscalReceiptNumber)}</span></div><div class="pair"><span>${t('ФП')}</span><span>${escape(fiscal.fiscalSign)}</span></div>
    ${fiscal.simulated ? '' : fiscalQr(fiscal.qrCode)}` : '';
  const paymentParts = r.payments?.length
    ? r.payments.map((part) => `${t(paymentMethodLabel(part.method))}: ${money(part.amount)}`)
    : r.paymentMethod ? [`${t(paymentMethodLabel(r.paymentMethod))}: ${money(r.finalAmount)}`] : ['—'];
  const payment = `<div class="pair payment"><span>${t('Оплата')}</span><span class="payment-value">${paymentParts.join(' · ')}</span></div>`;
  const html = `<!doctype html><html lang="${receiptLanguage}"><head><meta charset="utf-8"><title>${receiptKind} ${escape(orderNumber)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body { width: 80mm; margin: 0 auto; padding: 6mm 3mm 7mm; color: #000; background: #fff; font-family: Arial, sans-serif; font-size: 13px; font-weight: 400; line-height: 1.28; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h1 { font-family: Arial, sans-serif; font-size: 21px; line-height: 1.1; text-align: center; margin: 0 0 5px; font-weight: 700; letter-spacing: -0.4px; }
    .receipt-logo { display: block; max-width: 45mm; max-height: 20mm; width: auto; height: auto; margin: 0 auto 7px; object-fit: contain; }
    .receipt-kind { text-align: center; font-family: Arial, sans-serif; font-size: 15px; font-weight: 700; margin: 0 0 5px; }
    .muted { font-size: 12px; font-weight: 400; }
    .center { text-align: center; }
    .dash { border: 0; border-top: 1px dashed #111; margin: 9px 0; height: 0; }
    .solid { border: 0; border-top: 1px solid #111; margin: 8px 0; height: 0; }
    table { width: 100%; border-collapse: collapse; }
    th { border-bottom: 1px solid #111; padding: 0 0 6px; font-family: Arial, sans-serif; font-size: 10px; font-weight: 700; text-align: left; white-space: nowrap; }
    td { border-bottom: 1px dashed #777; padding: 6px 0; vertical-align: top; font-weight: 400; }
    tbody tr:last-child td { border-bottom: 0; }
    .item-name { padding-right: 5px; }
    .c { text-align: center; width: 14%; white-space: nowrap; }
    .r { text-align: right; white-space: nowrap; }
    .order-meta { font-size: 13px; text-align: center; font-weight: 400; }
    .total { display: flex; justify-content: space-between; align-items: baseline; font-family: Arial, sans-serif; font-size: 20px; font-weight: 700; letter-spacing: -0.1px; }
    .pair { display: flex; justify-content: space-between; gap: 10px; margin: 5px 0; font-weight: 400; }
    .pair > :last-child { text-align: right; }
    .payment { gap: 5px; font-size: 11px; white-space: nowrap; }
    .payment-value { flex: 1; max-width: none; white-space: nowrap; }
    .fiscal-qr { display: block; width: 142px; height: 142px; margin: 11px auto 2px; image-rendering: pixelated; }
    .footer { margin-top: 11px; font-size: 13px; font-weight: 400; }
  </style></head><body>
    ${r.receiptLogoData && imageData.test(r.receiptLogoData) ? `<img class="receipt-logo" src="${escape(r.receiptLogoData)}" alt="${t('Логотип на чеке')}" />` : ''}
    ${header.cafeName ? `<h1>${escape(header.cafeName)}</h1>` : ''}
    <div class="receipt-kind">${receiptKind}</div>
    ${header.address ? `<div class="center muted">${escape(header.address)}</div>` : ''}
    ${header.phones ? `<div class="center muted">${escape(header.phones)}</div>` : ''}
    ${r.instagram ? `<div class="center muted">Instagram: ${escape(r.instagram)}</div>` : ''}
    ${r.website ? `<div class="center muted">${t('Сайт')}: ${escape(r.website)}</div>` : ''}
    <div class="center muted">${dateStr}</div>
    <div class="dash"></div>
    <div class="order-meta">${escape(orderNumber)} · ${escape(orderPlace)} · ${escape(waiter)}</div>
    <div class="dash"></div>
    <table><colgroup><col style="width:48%"><col style="width:14%"><col style="width:18%"><col style="width:20%"></colgroup><thead><tr><th>${t('Наименование')}</th><th class="c">${t('Кол-во')}</th><th class="r">${t('Цена')}</th><th class="r">${t('Сумма')}</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="solid"></div>
    ${Number(r.discountAmount) > 0 ? `<div class="pair"><span>${t('Сумма')}</span><span>${money(r.totalAmount)}</span></div><div class="pair"><span>${t('Скидка')}</span><span>−${money(r.discountAmount)}</span></div>` : ''}
    ${Number(r.roundingAmount) > 0 ? `<div class="pair"><span>${t('Округление')}</span><span>−${money(r.roundingAmount ?? 0)}</span></div>` : ''}
    <div class="total"><span>${t('Итого')}</span><span>${money(r.finalAmount)}</span></div>
    ${preliminary || fiscal ? '' : (r.taxes ?? []).map((tax) =>
      `<div class="pair"><span>${t('В т. ч.')} ${escape(tax.name)} (${escape(String(tax.rate).replace('.', ',') + ' %')})</span><span>${money(tax.amount)}</span></div>`
    ).join('')}
    <div class="solid"></div>
    ${preliminary ? '' : payment}
    ${fiscalBlock}
    <div class="dash"></div>
    <div class="center footer">${preliminary ? t('Счёт. Не является фискальным документом.') : escape(receiptFooterText(r.thanks, receiptLanguage))}</div>
  </body></html>`;

  await waitForNativePrintReturn(() => Print.printAsync({ html }), signal);
}

export async function shareCsv(filename: string, rows: (string | number | null)[][]) {
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  await shareCsvText(filename, csv);
}

export async function shareCsvText(filename: string, csv: string, signal?: AbortSignal) {
  const directory = FileSystem.cacheDirectory;
  if (!directory) throw new Error('Не удалось создать файл отчёта');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Экспорт файлов недоступен на этом устройстве');
  if (signal?.aborted) return;
  const path = `${directory}${filename.replace(/[^\p{L}\p{N}._-]/gu, '_')}.csv`;
  const content = csv.startsWith('\ufeff') ? csv : '\ufeff' + csv;
  await FileSystem.writeAsStringAsync(path, content, { encoding: FileSystem.EncodingType.UTF8 });
  if (signal?.aborted) return;
  await Sharing.shareAsync(path, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Экспорт отчёта' });
}
