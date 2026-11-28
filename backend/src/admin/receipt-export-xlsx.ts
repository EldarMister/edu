import { OrderItemStatus, OrderStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { netOrderAmount, netPaymentAmount } from '../orders/order-net';

export const receiptExportItems = {
  where: { status: { notIn: [OrderItemStatus.cancelled, OrderItemStatus.rejected] } },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  select: { dishNameSnapshot: true, dishVariantNameSnapshot: true, quantity: true,
    refundedQuantity: true, priceSnapshot: true, finalPrice: true },
} satisfies Prisma.Order$itemsArgs;

export const receiptExportSelect = {
  id: true, orderNumber: true, createdAt: true, closedAt: true, status: true, source: true, comment: true,
  paymentMethod: true, finalAmount: true, refundedAmount: true, discountAmount: true, serviceChargeAmount: true,
  waiter: { select: { name: true } },
  table: { select: { name: true, number: true, hall: { select: { name: true } } } },
  payments: { select: { method: true, amount: true, status: true, refundedAmount: true } },
} satisfies Prisma.OrderSelect;

type ExportReceipt = Prisma.OrderGetPayload<{ select: typeof receiptExportSelect }> & {
  items?: Prisma.OrderItemGetPayload<{ select: typeof receiptExportItems.select }>[];
};
type Cell = string | number | null | undefined;
type Column = { label: string; width: number; format?: string };

const statusLabels: Record<OrderStatus, string> = {
  draft: 'Черновик', sent_to_kitchen: 'На кухне', accepted_by_kitchen: 'Принят кухней', cooking: 'Готовится',
  ready: 'Готов', picked_up: 'Забран', served: 'Подан', waiting_payment: 'Ожидает оплаты',
  paid: 'Оплачен', rejected: 'Отклонён', partially_rejected: 'Частично отклонён', cancelled: 'Отменён',
};
const paymentLabels: Record<PaymentMethod, string> = { cash: 'Наличные', card: 'Карта', qr: 'QR', mixed: 'Смешанная' };
const sourceLabels: Record<string, string> = { pos: 'В заведении', qr: 'QR-меню', delivery: 'Доставка', pickup: 'Самовывоз' };

const text = (label: string, width = 19): Column => ({ label, width });
const amount = (label: string): Column => ({ label, width: Math.max(15, label.length + 3), format: '#,##0.00 "с"' });
const date = (label: string): Column => ({ label, width: 22, format: 'dd"."mm"."yyyy hh:mm' });
const excelBishkekDate = (value: Date | null) => value == null ? null : (value.getTime() + 6 * 3600000) / 86400000 + 25569;

const receiptColumns = [
  text('№ чека', 14), date('Открыт (Бишкек)'), date('Закрыт (Бишкек)'), text('Официант', 27), text('Зал'), text('Стол'),
  text('Источник'), text('Статус'), text('Способ оплаты'), amount('Сумма чека'), amount('Скидка'), amount('Обслуживание'),
  amount('Возвраты'), amount('Выручка после возвратов'), amount('Наличные после возвратов'), amount('Карта после возвратов'),
  amount('QR после возвратов'), text('ID чека', 40), text('Комментарий', 45),
];
const itemColumns = [
  text('№ чека', 14), date('Открыт (Бишкек)'), text('Позиция', 35), text('Вариант', 27), text('Количество'),
  text('Возвращённое количество', 26), amount('Цена за единицу'), amount('Сумма позиции'), text('ID чека', 40),
];

function appendSheet(book: XLSX.WorkBook, name: string, columns: Column[], rows: Cell[][]) {
  const sheet = XLSX.utils.aoa_to_sheet([columns.map(({ label }) => label), ...rows]);
  sheet['!cols'] = columns.map(({ width }) => ({ wch: width }));
  if (rows.length && sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
  for (const [c, { format }] of columns.entries()) {
    if (!format) continue;
    for (let r = 1; r <= rows.length; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell?.t === 'n') cell.z = format;
    }
  }
  XLSX.utils.book_append_sheet(book, sheet, name);
}

function tenderAmounts(order: ExportReceipt) {
  const zero = new Prisma.Decimal(0);
  const totals = { cash: zero, card: zero, qr: zero };
  if (order.status !== OrderStatus.paid) return [null, null, null];
  if (order.payments.length) {
    for (const payment of order.payments) {
      if (payment.status === PaymentStatus.paid && payment.method !== PaymentMethod.mixed) {
        totals[payment.method] = totals[payment.method].add(netPaymentAmount(payment));
      }
    }
  } else if (order.paymentMethod && order.paymentMethod !== PaymentMethod.mixed) {
    totals[order.paymentMethod] = netOrderAmount(order);
  } else {
    return [null, null, null];
  }
  return [totals.cash.toNumber(), totals.card.toNumber(), totals.qr.toNumber()];
}

export function writeReceiptWorkbook(orders: ExportReceipt[], includeDetails: boolean): Buffer {
  const book = XLSX.utils.book_new();
  appendSheet(book, 'Чеки', receiptColumns, orders.map((order) => [
    order.orderNumber, excelBishkekDate(order.createdAt), excelBishkekDate(order.closedAt), order.waiter?.name,
    (order.source === 'delivery' || order.source === 'pickup') ? null : order.table.hall.name,
    (order.source === 'delivery' || order.source === 'pickup') ? null : order.table.name || `Стол ${order.table.number}`,
    sourceLabels[order.source] ?? order.source, statusLabels[order.status], order.paymentMethod ? paymentLabels[order.paymentMethod] : null,
    Number(order.finalAmount), Number(order.discountAmount), Number(order.serviceChargeAmount), Number(order.refundedAmount),
    order.status === OrderStatus.paid ? netOrderAmount(order).toNumber() : null, ...tenderAmounts(order), order.id, order.comment,
  ]));
  if (includeDetails) {
    appendSheet(book, 'Позиции', itemColumns, orders.flatMap((order) => (order.items ?? []).map((item) => [
      order.orderNumber, excelBishkekDate(order.createdAt), item.dishNameSnapshot, item.dishVariantNameSnapshot,
      item.quantity, item.refundedQuantity, Number(item.priceSnapshot), Number(item.finalPrice), order.id,
    ])));
  }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true });
}
