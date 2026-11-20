import QRCode from 'qrcode';
import type { Receipt } from '@/types';
import { displayOrderNumber, money, orderItemDisplayName, paymentMethodLabel, taxRateLabel, timeHM } from '@/lib/format';
import { translate, type TFunc } from '@/lib/i18n';
import { receiptFooterText, receiptHeader, receiptPrintSettings } from '@/lib/receipt';

/** Данные фискального чека от ККМ — если переданы, печатается фискальный чек, а не товарный. */
export interface FiscalPrintData {
  simulated?: boolean;
  receiptNumber?: string;
  sign?: string;
  /** QR ГНС: data URL картинки или строка/ссылка для проверки (тогда QR рисуется локально). */
  qrCode?: string;
}

/**
 * Открывает окно печати с чеком для термопринтера 58–80 мм.
 * `preliminary: true` печатает счёт — без блока оплаты, с пометкой, что это не фискальный документ.
 * `fiscal` задан — печатается фискальный чек (заголовок, номер, ФП и QR ГНС) вместо товарного.
 */
export async function printReceipt(
  r: Receipt,
  targetWindow?: Window | null,
  opts: { preliminary?: boolean; fiscal?: FiscalPrintData; onAfterPrint?: () => void } = {},
) {
  const preliminary = opts.preliminary ?? false;
  const fiscal = preliminary ? undefined : opts.fiscal;
  const { receiptLanguage } = receiptPrintSettings(r);
  const t: TFunc = (label) => translate(receiptLanguage, label);
  const header = receiptHeader(r, !!fiscal && !fiscal.simulated);
  const date = new Date(r.date);
  const dateStr = `${date.toLocaleDateString(receiptLanguage === 'ky' ? 'ky-KG' : 'ru-RU')} ${timeHM(r.date)}`;
  const orderNumber = displayOrderNumber(r.orderNumber);
  const receiptKind = t(preliminary ? 'Счёт' : fiscal?.simulated ? 'Тестовый чек' : fiscal ? 'Фискальный чек' : 'Товарный чек');
  const orderPlace = r.source === 'delivery' ? t('Доставка') : `${t('Стол')} ${r.tableNumber}`;
  const waiter = r.source === 'delivery' && r.waiter === 'Онлайн-заказ' ? t(r.waiter) : r.waiter;
  const rows = r.items
    .map(
      (it) =>
        `<tr><td class="item-name">${escapeHtml(orderItemDisplayName(it))}</td><td class="c">${it.quantity}</td><td class="r">${money(
          it.priceSnapshot,
        )}</td><td class="r">${money(it.finalPrice)}</td></tr>`,
    )
    .join('');

  // Блок фискального чека: номер, фискальный признак и QR ГНС (рисуем локально из ссылки/строки).
  const fiscalBlock = fiscal ? await buildFiscalBlock(fiscal, t) : '';

  const html = `<!doctype html><html lang="${receiptLanguage}"><head><meta charset="utf-8"><title>${receiptKind} ${escapeHtml(orderNumber)}</title>
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
    ${r.receiptLogoData ? `<img class="receipt-logo" src="${escapeHtml(r.receiptLogoData)}" alt="${t('Логотип на чеке')}" />` : ''}
    ${header.cafeName ? `<h1>${escapeHtml(header.cafeName)}</h1>` : ''}
    <div class="receipt-kind">${receiptKind}</div>
    ${header.address ? `<div class="center muted">${escapeHtml(header.address)}</div>` : ''}
    ${header.phones ? `<div class="center muted">${escapeHtml(header.phones)}</div>` : ''}
    ${r.instagram ? `<div class="center muted">Instagram: ${escapeHtml(r.instagram)}</div>` : ''}
    ${r.website ? `<div class="center muted">${t('Сайт')}: ${escapeHtml(r.website)}</div>` : ''}
    <div class="center muted">${dateStr}</div>
    <div class="dash"></div>
    <div class="order-meta">${escapeHtml(orderNumber)} · ${escapeHtml(orderPlace)} · ${escapeHtml(waiter)}</div>
    <div class="dash"></div>
    <table><colgroup><col style="width:48%"><col style="width:14%"><col style="width:18%"><col style="width:20%"></colgroup><thead><tr><th>${t('Наименование')}</th><th class="c">${t('Кол-во')}</th><th class="r">${t('Цена')}</th><th class="r">${t('Сумма')}</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="solid"></div>
    ${Number(r.discountAmount) > 0 ? `<div class="pair"><span>${t('Сумма')}</span><span>${money(r.totalAmount)}</span></div><div class="pair"><span>${t('Скидка')}</span><span>−${money(r.discountAmount)}</span></div>` : ''}
    ${Number(r.serviceChargeAmount) > 0 ? `<div class="pair"><span>${t('Обслуживание')}</span><span>${money(r.serviceChargeAmount)}</span></div>` : ''}
    ${Number(r.roundingAmount) > 0 ? `<div class="pair"><span>${t('Округление')}</span><span>−${money(r.roundingAmount ?? 0)}</span></div>` : ''}
    <div class="total"><span>${t('Итого')}</span><span>${money(r.finalAmount)}</span></div>
    ${preliminary || fiscal ? '' : (r.taxes ?? []).map((tax) =>
      `<div class="pair"><span>${t('В т. ч.')} ${escapeHtml(tax.name)} (${taxRateLabel(tax.rate)})</span><span>${money(tax.amount)}</span></div>`
    ).join('')}
    <div class="solid"></div>
    ${preliminary ? '' : paymentBlock(r, t)}
    ${fiscalBlock}
    <div class="dash"></div>
    <div class="center footer">${preliminary ? t('Счёт. Не является фискальным документом.') : escapeHtml(receiptFooterText(r.thanks, receiptLanguage))}</div>
  </body></html>`;

  const w = targetWindow ?? window.open('', '_blank', 'width=380,height=640');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  let afterPrintHandled = false;
  const handleAfterPrint = () => {
    if (afterPrintHandled) return;
    afterPrintHandled = true;
    opts.onAfterPrint?.();
  };
  w.addEventListener?.('afterprint', handleAfterPrint, { once: true });
  w.focus();
  setTimeout(async () => {
    if (w.closed) return;
    await Promise.allSettled(Array.from(w.document.images ?? []).map((image) => image.decode?.()));
    if (!w.closed) w.print();
  }, 300);
}

/** Фискальный блок чека: номер, ФП и QR ГНС (картинка генерируется из ссылки/строки). */
async function buildFiscalBlock(fiscal: FiscalPrintData, t: TFunc): Promise<string> {
  const lines: string[] = ['<div class="dash"></div>'];
  if (fiscal.receiptNumber) {
    lines.push(`<div class="pair"><span>${t(fiscal.simulated ? 'Тестовый чек №' : 'Фискальный чек №')}</span><span>${escapeHtml(fiscal.receiptNumber)}</span></div>`);
  }
  if (fiscal.sign) {
    lines.push(`<div class="pair"><span>${t('ФП')}</span><span>${escapeHtml(fiscal.sign)}</span></div>`);
  }
  const qrSrc = fiscal.simulated ? null : await fiscalQrSrc(fiscal.qrCode);
  if (qrSrc) {
    lines.push(`<img class="fiscal-qr" src="${escapeHtml(qrSrc)}" alt="${t('QR-код проверки фискального чека')}"/>`);
  }
  return lines.join('');
}

/** Готовый src картинки QR: data URL — как есть; ссылка/строка — рисуем QR локально. */
async function fiscalQrSrc(qrCode?: string): Promise<string | null> {
  if (!qrCode) return null;
  if (qrCode.startsWith('data:image')) return qrCode;
  try {
    return await QRCode.toDataURL(qrCode, { margin: 1, width: 300 });
  } catch {
    return null;
  }
}

/** Блок оплаты: выводит каждый фактический способ и его сумму в одной строке. */
function paymentBlock(r: Receipt, t: TFunc): string {
  const parts = r.payments?.length
    ? r.payments.map((p) => `${t(paymentMethodLabel(p.method))}: ${money(p.amount)}`)
    : r.paymentMethod
      ? [`${t(paymentMethodLabel(r.paymentMethod))}: ${money(r.finalAmount)}`]
      : ['—'];
  return `<div class="pair payment"><span>${t('Оплата')}</span><span class="payment-value">${parts.map(escapeHtml).join('&nbsp;')}</span></div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
