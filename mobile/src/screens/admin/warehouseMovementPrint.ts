import * as Print from 'expo-print';
import type { WarehouseMovementReport, WarehouseReportMovementRow } from '@/services/api/warehouse';
import { balanceMoney, balanceQuantity } from '@/utils/warehouseBalance';
import { warehouseTimeDisplay } from '@/utils/warehouseTiming';
import { waitForNativePrintReturn } from './nativePrintLifecycle';

export const journalColumns = [
  { label: 'Товар / дата', width: 170 },
  { label: 'Склад', width: 140 },
  { label: 'Количество', width: 100 },
  { label: 'Стоимость единицы', width: 128 },
  { label: 'Сумма', width: 108 },
  { label: 'Корректировка оценки', width: 132 },
  { label: 'Документ / сотрудник', width: 186 },
];

export const journalCost = (value: number | null) => value == null ? 'Неизвестно' : balanceMoney(value);

export function journalMovementValues(row: WarehouseReportMovementRow) {
  return [
    row.ingredientName, row.warehouseName, balanceQuantity(row.quantity, row.unit),
    row.unitCost == null ? journalCost(row.unitCost) : journalCost(row.unitCost) + ' / ' + row.unit,
    journalCost(row.totalCost), row.valuationAdjustment ? balanceMoney(row.valuationAdjustment) : '—',
  ];
}

const escape = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const detail = (value: string | null) => value ? `<small>${escape(value)}</small>` : '';

export function printWarehouseMovement(
  report: WarehouseMovementReport,
  { ingredientName, warehouseLabel }: { ingredientName: string; warehouseLabel: string },
  signal?: AbortSignal,
) {
  const tableRows = report.rows.map((row) => {
    const cells = journalMovementValues(row).map((value, index) => {
      const date = index === 0 ? detail(row.createdAt ? warehouseTimeDisplay(row.createdAt) : row.category) : '';
      return `<td>${escape(value)}${date}</td>`;
    }).join('');
    return `<tr>${cells}<td>${escape(row.documentLabel ?? 'Текущий остаток')}${detail(row.employeeName)}</td></tr>`;
  }).join('');
  const valuation = report.totalValuationAdjustment ? ' · корректировка оценки ' + balanceMoney(report.totalValuationAdjustment) : '';
  const body = tableRows ? `<table><thead><tr>${journalColumns.map(({ label }) => `<th scope="col">${escape(label)}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table>`
    : '<p>По выбранным условиям движений нет.</p>';
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
@page { size: landscape; margin: 10mm; }
body { color: #000; background: #fff; font: 11px Arial, sans-serif; margin: 0; }
h1 { font-size: 18px; margin: 0 0 8px; }
p { margin: 0 0 8px; }
table { width: 100%; table-layout: fixed; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border: 1px solid #ccc; padding: 5px; text-align: left; vertical-align: top; overflow-wrap: break-word; }
small { display: block; font-size: 9px; margin-top: 2px; }
</style></head><body><h1>Движение товара · ${escape(ingredientName)}</h1>
<p>${escape(warehouseLabel)}</p><p>${report.totalRows} строк · <strong>Итого: ${escape(journalCost(report.totalCost) + valuation)}</strong></p>
${body}</body></html>`;
  return waitForNativePrintReturn(() => Print.printAsync({ html, orientation: Print.Orientation.landscape }), signal);
}
