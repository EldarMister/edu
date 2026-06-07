import type { Receipt, PaymentMethod } from '@/types';
import { displayOrderNumber, money, orderItemDisplayName, timeHM } from '@/lib/format';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  qr: 'QR-код',
  cash: 'Наличные',
  card: 'Карта',
};

/** Открывает окно печати с компактным чеком (подходит для термопринтера 58–80мм). */
export function printReceipt(r: Receipt) {
  const date = new Date(r.date);
  const dateStr = `${date.toLocaleDateString('ru-RU')} ${timeHM(r.date)}`;
  const orderNumber = displayOrderNumber(r.orderNumber);
  const rows = r.items
    .map(
      (it) =>
        `<tr><td>${escapeHtml(orderItemDisplayName(it))}</td><td class="c">${it.quantity}</td><td class="r">${money(
          it.finalPrice,
        )}</td></tr>`,
    )
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Чек ${orderNumber}</title>
  <style>
    @page { margin: 0; }
    body { width: 76mm; margin: 0 auto; padding: 6mm 4mm; font-family: 'Inter', monospace, sans-serif; color: #000; font-size: 12px; }
    h1 { font-size: 15px; text-align: center; margin: 0 0 2px; font-weight: 600; }
    .muted { color: #333; font-size: 11px; }
    .center { text-align: center; }
    hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2px 0; vertical-align: top; }
    .c { text-align: center; width: 28px; }
    .r { text-align: right; white-space: nowrap; }
    .total { font-size: 14px; font-weight: 600; }
    .row { display: flex; justify-content: space-between; }
  </style></head><body>
    <h1>${escapeHtml(r.cafeName)}</h1>
    ${r.address ? `<div class="center muted">${escapeHtml(r.address)}</div>` : ''}
    ${r.phone ? `<div class="center muted">${escapeHtml(r.phone)}${r.phone2 ? ', ' + escapeHtml(r.phone2) : ''}</div>` : ''}
    <div class="center muted">${dateStr}</div>
    <hr/>
    <div class="row muted"><span>Заказ</span><span>${escapeHtml(orderNumber)}</span></div>
    <div class="row muted"><span>Стол</span><span>${r.tableNumber}</span></div>
    <div class="row muted"><span>Официант</span><span>${escapeHtml(r.waiter)}</span></div>
    <hr/>
    <table>${rows}</table>
    <hr/>
    ${Number(r.discountAmount) > 0 ? `<div class="row"><span>Сумма</span><span>${money(r.totalAmount)}</span></div><div class="row"><span>Скидка</span><span>−${money(r.discountAmount)}</span></div>` : ''}
    <div class="row total"><span>Итого</span><span>${money(r.finalAmount)}</span></div>
    <div class="row muted"><span>Оплата</span><span>${r.paymentMethod ? METHOD_LABEL[r.paymentMethod] : '—'}</span></div>
    <hr/>
    <div class="center muted">${escapeHtml(r.thanks)}</div>
  </body></html>`;

  const w = window.open('', '_blank', 'width=380,height=640');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 300);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
