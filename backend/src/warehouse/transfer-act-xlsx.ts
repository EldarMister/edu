import { Prisma, type WarehouseDocument, type WarehouseDocumentItem } from '@prisma/client';
import * as XLSX from 'xlsx';
import { fromBase, normalizeUnit, unitLabel } from './units';

const transferTime = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const quantityFormat = '#,##0.######';
const moneyFormat = '#,##0.00 "с"';

export function writeTransferAct(document: WarehouseDocument & { items: WarehouseDocumentItem[] },
  sender: string, recipient: string, showCosts: boolean): Buffer {
  const date = document.effectiveAt ?? document.postedAt ?? document.createdAt;
  const widths = [45, 16, 18, ...(showCosts ? [18] : [])];
  let total: Prisma.Decimal | null = new Prisma.Decimal(0);
  const items = document.items.map((item) => {
    const unit = normalizeUnit(item.unit);
    const amount = item.difference?.abs() ?? item.quantity;
    const row = [item.name, unitLabel(unit), amount == null ? null : fromBase(Number(amount), unit)];
    if (!showCosts) return row;
    const value = item.costKnown && item.unitCost != null && amount != null ? amount.mul(item.unitCost) : null;
    total = total != null && value != null ? total.add(value) : null;
    return [...row, value == null ? 'Не рассчитано' : Number(value.toDecimalPlaces(2))];
  });
  const header = [
    ['Акт перемещения'],
    ['Документ', document.id],
    ['Дата и время (Бишкек)', transferTime.format(date)],
    ['Со склада', sender],
    ['На склад', recipient],
    ['Статус', document.status === 'reversed' ? 'Сторнировано' : 'Проведено'],
    ['Сотрудник', document.postedByName ?? document.createdByName],
    ...(document.note ? [['Комментарий', document.note]] : []),
    [],
    ['Наименование', 'Ед. изм.', 'Количество', ...(showCosts ? ['Сумма'] : [])],
  ];
  const sheet = XLSX.utils.aoa_to_sheet([...header, ...items]);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: widths.length - 1 } }, ...header.slice(1, -2).map((_, index) =>
    ({ s: { r: index + 1, c: 1 }, e: { r: index + 1, c: widths.length - 1 } }))];
  items.forEach((_, index) => {
    const row = index + header.length + 1;
    if (sheet[`C${row}`]) sheet[`C${row}`].z = quantityFormat;
    if (showCosts && sheet[`D${row}`]?.t === 'n') sheet[`D${row}`].z = moneyFormat;
  });
  if (showCosts) {
    const row = header.length + items.length + 1;
    XLSX.utils.sheet_add_aoa(sheet, [['Итого', null, null, total == null ? 'Не рассчитано' : Number(total.toDecimalPlaces(2))]], { origin: `A${row}` });
    if (sheet[`D${row}`].t === 'n') sheet[`D${row}`].z = moneyFormat;
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Акт перемещения');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
