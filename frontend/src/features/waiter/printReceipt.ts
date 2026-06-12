import type { Receipt, PaymentMethod } from '@/types';
import { displayOrderNumber, money, orderItemDisplayName, timeHM, isSplitPayment } from '@/lib/format';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  qr: 'QR-код',
  cash: 'Наличные',
  card: 'Карта',
  mixed: 'Смешанная',
};

/**
 * Открывает окно печати с компактным чеком (подходит для термопринтера 58–80мм).
 * `preliminary: true` печатает предварительный чек (предчек) — без блока оплаты,
 * с пометкой, что это не фискальный документ.
 */
export function printReceipt(
  r: Receipt,
  targetWindow?: Window | null,
  opts: { preliminary?: boolean } = {},
) {
  const preliminary = opts.preliminary ?? false;
  const date = new Date(r.date);
  const dateStr = `${date.toLocaleDateString('ru-RU')} ${timeHM(r.date)}`;
  const orderNumber = displayOrderNumber(r.orderNumber);
  const docTitle = preliminary ? 'Предчек' : 'Чек';
  const rows = r.items
    .map(
      (it) =>
        `<tr><td>${escapeHtml(orderItemDisplayName(it))}</td><td class="c">${it.quantity}</td><td class="r">${money(
          it.finalPrice,
        )}</td></tr>`,
    )
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle} ${orderNumber}</title>
  <style>
    @page { margin: 0; }
    body { width: 80mm; margin: 0 auto; padding: 8mm 4mm; font-family: 'Inter', monospace, sans-serif; color: #000; font-size: 14px; }
    h1 { font-size: 20px; text-align: center; margin: 0 0 6px; font-weight: 600; }
    .muted { color: #333; font-size: 13px; }
    .center { text-align: center; }
    hr { border: none; border-top: 1px dashed #999; margin: 12px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 4px 0; vertical-align: top; }
    .c { text-align: center; width: 36px; }
    .r { text-align: right; white-space: nowrap; }
    .total { font-size: 18px; font-weight: 700; margin-top: 6px; }
    .row { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .row-inline { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 12px; }
    .sep { color: #999; margin: 0 3px; }
  </style></head><body>
    <h1>${escapeHtml(r.cafeName)}</h1>
    ${r.address ? `<div class="center muted">${escapeHtml(r.address)}</div>` : ''}
    ${r.phone ? `<div class="center muted">${escapeHtml(r.phone)}${r.phone2 ? ', ' + escapeHtml(r.phone2) : ''}</div>` : ''}
    <div class="center muted">${dateStr}</div>
    <hr/>
    <div class="row muted" style="font-size:12px">
      <span>${escapeHtml(orderNumber)}</span>
      <span style="color:#999;margin:0 4px">·</span>
      <span>Стол ${r.tableNumber}</span>
      <span style="color:#999;margin:0 4px">·</span>
      <span style="flex:1;text-align:right">${escapeHtml(r.waiter)}</span>
    </div>
    <hr/>
    <table>${rows}</table>
    <hr/>
    ${Number(r.discountAmount) > 0 ? `<div class="row"><span>Сумма</span><span>${money(r.totalAmount)}</span></div><div class="row"><span>Скидка</span><span>−${money(r.discountAmount)}</span></div>` : ''}
    ${Number(r.serviceChargeAmount) > 0 ? `<div class="row"><span>Обслуживание</span><span>${money(r.serviceChargeAmount)}</span></div>` : ''}
    <div class="row total"><span>Итого</span><span>${money(r.finalAmount)}</span></div>
    ${preliminary ? '' : paymentBlock(r)}
    <hr/>
    <div class="center muted">${preliminary ? 'Предварительный расчёт. Не является фискальным документом.' : escapeHtml(r.thanks)}</div>
  </body></html>`;

  const w = targetWindow ?? window.open('', '_blank', 'width=380,height=640');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 300);
}

/** Блок оплаты: для смешанной — в одну строку через «·», иначе один способ. */
function paymentBlock(r: Receipt): string {
  if (isSplitPayment(r)) {
    const parts = (r.payments ?? []).map((p, i) => `Платеж ${i + 1}: ${METHOD_LABEL[p.method]} ${money(p.amount)}`);
    return `<div class="row muted" style="font-size:12px"><span>Оплата</span><span>Раздельная оплата</span></div>${
      parts.length ? `<div class="muted" style="font-size:12px">${parts.map(escapeHtml).join('<br/>')}</div>` : ''
    }`;
  }
  if (r.payments && r.payments.length > 1) {
    // Все способы в одну строку: «QR-код 2 100 с · Наличные 1 500 с»
    const parts = r.payments.map((p) => `${METHOD_LABEL[p.method]}: ${money(p.amount)}`).join(' · ');
    return `<div class="row muted" style="font-size:12px"><span>Оплата</span><span>${parts}</span></div>`;
  }
  const label = r.paymentMethod ? METHOD_LABEL[r.paymentMethod] : '—';
  return `<div class="row muted"><span>Оплата</span><span>${label}</span></div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
