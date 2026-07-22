import QRCode from 'qrcode';
import type { Receipt, PaymentMethod } from '@/types';
import { displayOrderNumber, money, orderItemDisplayName, timeHM } from '@/lib/format';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  qr: 'QR-код',
  cash: 'Наличные',
  card: 'Карта',
  mixed: 'Смешанная',
};

/** Данные фискального чека от ККМ — если переданы, печатается фискальный чек, а не товарный. */
export interface FiscalPrintData {
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
  const date = new Date(r.date);
  const dateStr = `${date.toLocaleDateString('ru-RU')} ${timeHM(r.date)}`;
  const orderNumber = displayOrderNumber(r.orderNumber);
  const docTitle = preliminary ? 'Счёт' : fiscal ? 'Фискальный чек' : 'Товарный чек';
  const receiptKind = preliminary ? 'Счёт' : fiscal ? 'Фискальный чек' : 'Товарный чек';
  const rows = r.items
    .map(
      (it) =>
        `<tr><td class="item-name">${escapeHtml(orderItemDisplayName(it))}</td><td class="c">${it.quantity}</td><td class="r">${money(
          it.priceSnapshot,
        )}</td><td class="r">${money(it.finalPrice)}</td></tr>`,
    )
    .join('');

  // Блок фискального чека: номер, фискальный признак и QR ГНС (рисуем локально из ссылки/строки).
  const fiscalBlock = fiscal ? await buildFiscalBlock(fiscal) : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle} ${orderNumber}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body { width: 80mm; margin: 0 auto; padding: 7mm 4mm 8mm; color: #000; background: #fff; font-family: "Courier New", Courier, monospace; font-size: 13px; font-weight: 600; line-height: 1.32; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h1 { font-family: Arial, sans-serif; font-size: 22px; line-height: 1.1; text-align: center; margin: 0 0 7px; font-weight: 700; letter-spacing: -0.4px; }
    .receipt-kind { text-align: center; font-family: Arial, sans-serif; font-size: 16px; font-weight: 700; margin: 0 0 7px; }
    .muted { font-size: 12px; }
    .center { text-align: center; }
    .dash { border: 0; border-top: 1px dashed #111; margin: 12px 0; height: 0; }
    .solid { border: 0; border-top: 1px solid #111; margin: 9px 0; height: 0; }
    table { width: 100%; border-collapse: collapse; }
    th { border-bottom: 1px solid #111; padding: 0 0 7px; font-family: Arial, sans-serif; font-size: 11px; font-weight: 700; text-align: left; }
    td { border-bottom: 1px dashed #777; padding: 8px 0; vertical-align: top; }
    tbody tr:last-child td { border-bottom: 0; }
    .item-name { padding-right: 5px; }
    .c { text-align: center; width: 12%; }
    .r { text-align: right; white-space: nowrap; }
    .order-meta { font-size: 13px; text-align: center; }
    .total { display: flex; justify-content: space-between; align-items: baseline; font-family: Arial, sans-serif; font-size: 20px; font-weight: 700; letter-spacing: -0.1px; }
    .pair { display: flex; justify-content: space-between; gap: 10px; margin: 6px 0; }
    .pair > :last-child { text-align: right; }
    .payment { font-size: 12px; }
    .payment-value { max-width: 76%; }
    .fiscal-qr { display: block; width: 146px; height: 146px; margin: 13px auto 2px; image-rendering: pixelated; }
    .footer { margin-top: 14px; font-size: 13px; }
  </style></head><body>
    <h1>${escapeHtml(r.cafeName)}</h1>
    <div class="receipt-kind">${receiptKind}</div>
    ${r.address ? `<div class="center muted">${escapeHtml(r.address)}</div>` : ''}
    ${r.phone ? `<div class="center muted">${escapeHtml(r.phone)}${r.phone2 ? ', ' + escapeHtml(r.phone2) : ''}</div>` : ''}
    ${r.instagram ? `<div class="center muted">Instagram: ${escapeHtml(r.instagram)}</div>` : ''}
    ${r.website ? `<div class="center muted">Сайт: ${escapeHtml(r.website)}</div>` : ''}
    <div class="center muted">${dateStr}</div>
    <div class="dash"></div>
    <div class="order-meta">${escapeHtml(orderNumber)} · Стол ${r.tableNumber} · ${escapeHtml(r.waiter)}</div>
    <div class="dash"></div>
    <table><colgroup><col style="width:46%"><col style="width:12%"><col style="width:20%"><col style="width:22%"></colgroup><thead><tr><th>Наименование</th><th class="c">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="solid"></div>
    ${Number(r.discountAmount) > 0 ? `<div class="pair"><span>Сумма</span><span>${money(r.totalAmount)}</span></div><div class="pair"><span>Скидка</span><span>−${money(r.discountAmount)}</span></div>` : ''}
    ${Number(r.serviceChargeAmount) > 0 ? `<div class="pair"><span>Обслуживание</span><span>${money(r.serviceChargeAmount)}</span></div>` : ''}
    <div class="total"><span>Итого</span><span>${money(r.finalAmount)}</span></div>
    <div class="solid"></div>
    ${preliminary ? '' : paymentBlock(r)}
    ${fiscalBlock}
    <div class="dash"></div>
    <div class="center footer">${preliminary ? 'Счёт. Не является фискальным документом.' : escapeHtml(r.thanks)}</div>
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
  setTimeout(() => {
    w.print();
  }, 300);
}

/** Фискальный блок чека: номер, ФП и QR ГНС (картинка генерируется из ссылки/строки). */
async function buildFiscalBlock(fiscal: FiscalPrintData): Promise<string> {
  const lines: string[] = ['<div class="dash"></div>'];
  if (fiscal.receiptNumber) {
    lines.push(`<div class="pair"><span>Фискальный чек №</span><span>${escapeHtml(fiscal.receiptNumber)}</span></div>`);
  }
  if (fiscal.sign) {
    lines.push(`<div class="pair"><span>ФП</span><span>${escapeHtml(fiscal.sign)}</span></div>`);
  }
  const qrSrc = await fiscalQrSrc(fiscal.qrCode);
  if (qrSrc) {
    lines.push(`<img class="fiscal-qr" src="${qrSrc}" alt="QR-код проверки фискального чека"/>`);
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
function paymentBlock(r: Receipt): string {
  const parts = r.payments?.length
    ? r.payments.map((p) => `${METHOD_LABEL[p.method]}: ${money(p.amount)}`)
    : r.paymentMethod
      ? [`${METHOD_LABEL[r.paymentMethod]}: ${money(r.finalAmount)}`]
      : ['—'];
  return `<div class="pair payment"><span>Оплата</span><span class="payment-value">${parts.map(escapeHtml).join(' &nbsp; ')}</span></div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
