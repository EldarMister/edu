import type { WarehouseDocumentStatus, WarehouseInventoryMode } from '@prisma/client';
import * as XLSX from 'xlsx';
import type { inventoryPeriodContext } from './inventory-period-context';

type InventoryContext = Awaited<ReturnType<typeof inventoryPeriodContext>>;
type InventorySnapshot = {
  id: string;
  status: WarehouseDocumentStatus;
  mode: WarehouseInventoryMode | null;
  reopenedAt: Date | null;
  createdAt: Date;
  postedAt: Date | null;
  note: string | null;
  varianceValue: number | null;
  items: {
    ingredientId: string;
    name: string;
    unit: string;
    expected: number | null;
    quantity: number | null;
    difference: number | null;
    unitCost: number | null;
    value: number | null;
  }[];
};

const dateTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Bishkek', dateStyle: 'short', timeStyle: 'short',
});
const statusLabels: Record<WarehouseDocumentStatus, string> = {
  draft: 'Черновик',
  submitted: 'На утверждении',
  posted: 'Проведена',
  reversed: 'Сторнирована',
};
const quantityFormat = '#,##0.######';
const moneyFormat = '#,##0.00 "с"';

export function writeInventoryWorkbook(
  inventory: InventorySnapshot, warehouse: string, context: InventoryContext | undefined, showCosts: boolean,
): Buffer {
  const flows = new Map(context?.rows.map((row) => [row.ingredientId, row]));
  const rows = inventory.items.map((item) => {
    const flow = flows.get(item.ingredientId);
    return [
      item.name, item.unit, flow?.lastCountAt ? dateTime.format(flow.lastCountAt) : null,
      flow?.openingQuantity, flow?.incomingQuantity, flow?.consumptionQuantity, flow?.writeoffQuantity, flow?.otherQuantity,
      item.expected, item.quantity, item.difference, ...(showCosts ? [item.unitCost, item.value] : []),
    ];
  });
  const metadata = [
    ['Инвентаризация'],
    ['Документ', inventory.id],
    ['Склад', warehouse],
    ['Тип', inventory.mode === 'full' ? 'Полная' : 'Частичная'],
    ['Статус', inventory.reopenedAt && inventory.status === 'draft' ? 'Открыта для редактирования' : statusLabels[inventory.status]],
    ['Начало (Бишкек)', dateTime.format(inventory.createdAt)],
    ...(context ? [['Проверка остатков (Бишкек)', dateTime.format(context.cutoffAt)]] : []),
    ...(inventory.postedAt ? [['Проведена (Бишкек)', dateTime.format(inventory.postedAt)]] : []),
    ...(inventory.note ? [['Комментарий', inventory.note]] : []),
  ];
  const headers = ['Наименование', 'Ед. изм.', 'Предыдущая проверка (Бишкек)', 'Начальный остаток', 'Поступления',
    'Расход по продажам', 'Ручные списания', 'Другие движения', 'Плановый остаток', 'Фактический остаток', 'Разница',
    ...(showCosts ? ['Себестоимость за ед.', 'Разница в деньгах'] : [])];
  const sheet = XLSX.utils.aoa_to_sheet([...metadata, [], headers, ...rows]);
  sheet['!cols'] = [40, 12, 31, 20, 16, 22, 18, 18, 19, 21, 15, ...(showCosts ? [23, 22] : [])]
    .map((wch) => ({ wch }));
  sheet['!merges'] = metadata.map((_, r) => ({ s: { r, c: r ? 1 : 0 }, e: { r, c: headers.length - 1 } }));
  const firstDataRow = metadata.length + 2;
  const lastDataRow = firstDataRow + rows.length;
  if (rows.length) {
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({
      s: { r: firstDataRow - 1, c: 0 }, e: { r: lastDataRow - 1, c: headers.length - 1 },
    }) };
  }
  for (let r = firstDataRow; r < lastDataRow; r++) {
    for (let c = 3; c < headers.length; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell?.t === 'n') cell.z = c <= 10 ? quantityFormat : moneyFormat;
    }
  }
  if (showCosts) {
    XLSX.utils.sheet_add_aoa(sheet, [['Итоговая разница в деньгах']], { origin: { r: lastDataRow, c: 0 } });
    const origin = { r: lastDataRow, c: headers.length - 1 };
    XLSX.utils.sheet_add_aoa(sheet, [[inventory.varianceValue ?? 'Не рассчитано']], { origin });
    const total = sheet[XLSX.utils.encode_cell(origin)];
    if (total.t === 'n') total.z = moneyFormat;
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Инвентаризация');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
