import type { FoodCostReport } from './food-cost-report';
import type { FoodCostExportQuery } from './reports.dto';
import { unitLabel } from './units';
import { warehouseMoneyFormat, writeWarehouseWorkbook } from './warehouse-register-xlsx';

const label = (label: string, width: number) => ({ label, width });
const money = (label: string) => ({ label, width: Math.max(label.length + 2, 19), format: warehouseMoneyFormat });
const percent = (label: string) => ({ label, width: Math.max(label.length + 2, 19), format: '0.00"%"' });
const delta = (current: number | null, previous: number | null) =>
  current == null || previous == null || previous === 0 ? null : (current - previous) / Math.abs(previous) * 100;

export function writeFoodCostWorkbook(report: FoodCostReport, { tab, search }: Pick<FoodCostExportQuery, 'tab' | 'search'>) {
  const term = search?.trim().toLocaleLowerCase('ru') ?? '';
  const details = tab === 'positions' ? {
    name: 'Позиции',
    columns: [label('Позиция', 38), label('Категория', 27), label('Ед. цены', 12), money('Цена меню'),
      label('Продано, ед. цены', 21), money('Выручка'), money('Себестоимость'), money('Себестоимость ед.'), money('Маржа'), percent('Фудкост'),
      percent('Фудкост прошл. периода')],
    rows: report.positions.filter(({ name, category }) => `${name} ${category}`.toLocaleLowerCase('ru').includes(term))
      .map(({ name, category, price, priceBasis, priceUnit, current, previous }) => [name, category,
        `${priceBasis} ${unitLabel(priceUnit)}`, price, current.quantity, current.revenue,
        current.cost, current.cost != null && current.quantity > 0 ? current.cost / current.quantity : null,
        current.margin, current.foodCostPercent, previous.foodCostPercent]),
  } : {
    name: 'Ингредиенты',
    columns: [label('Ингредиент', 42), label('Ед. изм.', 12), label('Израсходовано в продажах', 27), money('Стоимость расхода'),
      percent('Динамика стоимости расхода'), money('Закупочная цена прошл. периода'), money('Закупочная цена тек. периода'),
      percent('Изменение закупочной цены')],
    rows: report.ingredients.filter(({ name }) => name.toLocaleLowerCase('ru').includes(term))
      .map(({ name, unit, current, previous }) => [name, unit, current.quantity, current.cost, delta(current.cost, previous.cost),
        previous.purchasePrice, current.purchasePrice, delta(current.purchasePrice, previous.purchasePrice)]),
  };
  return writeWarehouseWorkbook([details, {
    name: 'Периоды',
    columns: [label('Период', 22), label('Начало', 16), label('Конец', 16)],
    rows: [['Выбранный', report.current.from, report.current.to], ['Предыдущий', report.previous.from, report.previous.to]],
  }]);
}
