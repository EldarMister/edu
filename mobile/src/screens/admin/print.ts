import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import QRCode from 'qrcode';
import type { Receipt } from '@/types';
import type { FiscalResult } from '@/services/api/admin';
import { displayOrderNumber, money, orderItemDisplayName, paymentMethodLabel } from '@/utils/format';
import { waitForNativePrintReturn } from './nativePrintLifecycle';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function fiscalQr(value: string | undefined): string {
  if (!value) return '';
  if (value.startsWith('data:image')) return `<img width="140" height="140" src="${escape(value)}">`;
  const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const path: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (modules.get(row, column)) path.push(`M${column + 4},${row + 4}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 ${modules.size + 8} ${modules.size + 8}"><rect width="100%" height="100%" fill="white"/><path d="${path.join('')}" fill="black"/></svg>`;
}

export async function printNativeReceipt(receipt: Receipt, preliminary = false, fiscal?: FiscalResult | null, signal?: AbortSignal) {
  const rows = receipt.items.map((item) => `<tr><td>${escape(orderItemDisplayName(item))}<br>${item.quantity} × ${escape(money(item.priceSnapshot))}</td><td class="amount">${escape(money(item.finalPrice))}</td></tr>`).join('');
  const fiscalHtml = fiscal?.success ? `<hr><b>Фискальный чек № ${escape(fiscal.fiscalReceiptNumber)}</b><p>ФП: ${escape(fiscal.fiscalSign)}</p>${fiscalQr(fiscal.qrCode)}` : '';
  const paymentHtml = preliminary ? '<p>Предварительный счёт. Не является фискальным документом.</p>' : receipt.payments?.length ? receipt.payments.map((payment) => `<p>${escape(paymentMethodLabel(payment.method))}: ${escape(money(payment.amount))}</p>`).join('') : receipt.paymentMethod ? `<p>${escape(paymentMethodLabel(receipt.paymentMethod))}</p>` : '';
  await waitForNativePrintReturn(() => Print.printAsync({ html: `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:10mm}body{font-family:monospace;font-size:13px;max-width:320px;margin:auto}h1{text-align:center;font-size:19px}p{margin:5px 0}table{width:100%;border-collapse:collapse}td{padding:5px 0;vertical-align:top}.amount{text-align:right;white-space:nowrap}.total{font-size:18px;font-weight:bold}hr{border:0;border-top:1px dashed #888}</style></head><body><h1>${escape(receipt.cafeName)}</h1><p>${escape(receipt.address)}</p><p>${escape([receipt.phone, receipt.phone2].filter(Boolean).join(' / '))}</p><hr><b>${preliminary ? 'СЧЁТ' : fiscal?.success ? 'ФИСКАЛЬНЫЙ ЧЕК' : 'ТОВАРНЫЙ ЧЕК'} ${escape(displayOrderNumber(receipt.orderNumber))}</b><p>Стол ${receipt.tableNumber} · ${escape(receipt.waiter)}</p><p>${escape(new Date(receipt.date).toLocaleString('ru-RU'))}</p><hr><table>${rows}</table><hr><p>Итого: ${escape(money(receipt.totalAmount))}</p>${Number(receipt.discountAmount) ? `<p>Скидка: ${escape(money(receipt.discountAmount))}</p>` : ''}${Number(receipt.serviceChargeAmount) ? `<p>Обслуживание: ${escape(money(receipt.serviceChargeAmount))}</p>` : ''}<p class="total">К оплате: ${escape(money(receipt.finalAmount))}</p>${paymentHtml}${fiscalHtml}<hr><p>${escape(receipt.thanks)}</p><p>${escape([receipt.instagram, receipt.website].filter(Boolean).join(' · '))}</p></body></html>` }), signal);
}

export async function shareCsv(filename: string, rows: (string | number | null)[][]) {
  const directory = FileSystem.cacheDirectory;
  if (!directory) throw new Error('Не удалось создать файл отчёта');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Экспорт файлов недоступен на этом устройстве');
  const path = `${directory}${filename.replace(/[^\p{L}\p{N}._-]/gu, '_')}.csv`;
  const csv = '\ufeff' + rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(path, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Экспорт отчёта' });
}
