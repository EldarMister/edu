import { BadRequestException } from '@nestjs/common';
import { Prisma, PurchaseStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { normalizeUnit, unitLabel } from './units';
import type { PurchasePaymentStatus } from './purchase-settlement';

const columns = {
  number: { label: '№', width: 17 },
  date: { label: 'Дата', width: 22 },
  supplier: { label: 'Поставщик', width: 30 },
  warehouse: { label: 'Склад', width: 25 },
  fundingAccounts: { label: 'Счёт', width: 28 },
  products: { label: 'Товары', width: 55 },
  note: { label: 'Комментарий', width: 40 },
  status: { label: 'Статус', width: 16 },
  totalAmount: { label: 'Сумма', width: 18 },
  paymentStatus: { label: 'Оплата', width: 23 },
  paidAmount: { label: 'Оплачено', width: 18 },
  debtAmount: { label: 'Задолженность', width: 18 },
};
type Column = keyof typeof columns;
const legacyColumns: Column[] = ['number', 'date', 'supplier', 'warehouse', 'products', 'note', 'status', 'totalAmount'];
type ExportPurchase = Prisma.PurchaseGetPayload<{
  include: { items: { include: { ingredient: { select: { name: true; category: true } } } } };
}> & { paymentStatus: PurchasePaymentStatus | null; paidAmount: number | null; debtAmount: number | null; fundingAccounts?: Set<string> };
const statuses: Record<PurchaseStatus, string> = { draft: 'Черновик', completed: 'Проведена', cancelled: 'Отменена' };
const paymentStatuses: Record<PurchasePaymentStatus, string> = {
  untracked: 'Требует сверки', unpaid: 'Не оплачена', partly_paid: 'Частично оплачена', paid: 'Оплачена', overpaid: 'Переплата',
};
const excelDate = (date: Date) => (date.getTime() + 6 * 60 * 60 * 1000) / 86400000 + 25569;

export function purchaseExportColumns(selection?: string): Column[] {
  const requested = selection === undefined ? legacyColumns : selection.split(',').map((value) => value.trim());
  if (!requested.length || requested.some((key) => !Object.prototype.hasOwnProperty.call(columns, key)) || new Set(requested).size !== requested.length) {
    throw new BadRequestException('Укажите допустимые столбцы поставок без повторов');
  }
  return requested as Column[];
}

export function writePurchaseWorkbook(purchases: ExportPurchase[], warehouseNames: Map<string, string>, defaultWarehouseName: string, selection: Column[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([selection.map((key) => columns[key].label)]);
  sheet['!cols'] = selection.map((key) => ({ wch: columns[key].width }));
  const hasTax = purchases.some(purchase => purchase.items.some(item => item.taxId));
  const taxColumns = hasTax ? ['Налог', 'Сумма налога', 'Общая сумма с налогом'] : [];
  const lines = XLSX.utils.aoa_to_sheet([['№ поставки', 'Дата', 'Поставщик', 'Склад', 'Товар', 'Категория', 'Ед. изм.', 'Количество', 'Цена до скидки', 'Сумма до скидки',
    hasTax ? 'Сумма без налога со скидкой' : 'Сумма со скидкой', ...taxColumns]]);
  lines['!cols'] = [17, 22, 30, 25, 35, 25, 20, 18, 20, 20, 28, ...taxColumns.map(() => 24)].map((wch) => ({ wch }));
  let lineIndex = 1;
  for (const [index, purchase] of purchases.entries()) {
    const number = `ЗКП-${String(purchase.number).padStart(6, '0')}`;
    const warehouse = purchase.warehouseId ? warehouseNames.get(purchase.warehouseId) ?? 'Склад недоступен' : defaultWarehouseName;
    const date = excelDate(purchase.effectiveAt ?? purchase.stockPostedAt ?? purchase.date);
    const row = { number, date, supplier: purchase.supplier, warehouse, fundingAccounts: [...(purchase.fundingAccounts ?? [])].join(', '),
      products: [...new Set(purchase.items.map(({ ingredient }) => ingredient.name))].join(', '),
      note: purchase.note ?? '', status: statuses[purchase.status], totalAmount: Number(purchase.totalAmount),
      paymentStatus: purchase.paymentStatus ? paymentStatuses[purchase.paymentStatus] : '',
      paidAmount: purchase.paidAmount, debtAmount: purchase.debtAmount };
    XLSX.utils.sheet_add_aoa(sheet, [selection.map((key) => row[key])], { origin: { r: index + 1, c: 0 } });
    selection.forEach((key, c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c })];
      if (key === 'date') cell.z = 'dd.mm.yyyy hh:mm';
      if (cell && ['totalAmount', 'paidAmount', 'debtAmount'].includes(key)) cell.z = '#,##0.00 "с"';
    });
    for (const item of purchase.items) {
      let unit: string;
      try { unit = unitLabel(normalizeUnit(item.unit)); } catch { unit = item.unit; }
      if (item.packageName) unit = item.packageName;
      const taxCells = hasTax ? [item.taxId ? `${item.taxName} (${item.taxRate}%)` : 'Без налога', Number(item.taxAmount ?? 0),
        new Prisma.Decimal(item.total).add(item.taxAmount ?? 0).toNumber()] : [];
      XLSX.utils.sheet_add_aoa(lines, [[number, date, purchase.supplier, warehouse, item.ingredient.name, item.ingredient.category ?? '', unit,
        Number(item.quantity), Number(item.purchasePrice), Number(item.grossTotal), Number(item.total), ...taxCells]], { origin: { r: lineIndex, c: 0 } });
      lines[XLSX.utils.encode_cell({ r: lineIndex, c: 1 })].z = 'dd.mm.yyyy hh:mm';
      lines[XLSX.utils.encode_cell({ r: lineIndex, c: 7 })].z = '#,##0.000';
      for (const c of hasTax ? [8, 9, 10, 12, 13] : [8, 9, 10]) lines[XLSX.utils.encode_cell({ r: lineIndex, c })].z = '#,##0.00 "с"';
      lineIndex += 1;
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Поставки');
  XLSX.utils.book_append_sheet(workbook, lines, 'Позиции');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
